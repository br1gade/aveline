import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { problemFrom, type Problem } from '@/api/problems';
import { browserSession } from '@/api/session';
import {
  AppForm,
  ProblemAlert,
  SubmitButton,
  TextInputField,
  useLeaveGuardWhen,
} from '@/ui/app-form';

import { importVenueLayout, type VenueLayout } from '../inventory-api';

const schema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  name: z.string().trim().min(1).max(100),
});
type Values = z.infer<typeof schema>;
const CSV_LIMIT_BYTES = 8 * 1024 * 1024;
const TEMPLATE =
  'section_key,section_name,mode,row,seat,capacity\n' +
  'balcony,Balcony,NUMBERED,B,12,\n' +
  'floor,Floor,UNNUMBERED,,,200\n';

interface ImportProps {
  profileId: string;
  existing?: VenueLayout | undefined;
  onPublish: (layout: VenueLayout) => void;
}

function useLayoutImport({ profileId, existing, onPublish }: ImportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { key: existing?.key ?? '', name: existing?.name ?? '' },
  });
  useLeaveGuardWhen(form.formState.isDirty || Boolean(file));
  async function publish(values: Values) {
    if (!file || file.size > CSV_LIMIT_BYTES) return;
    setProblem(null);
    try {
      const next = await importVenueLayout(browserSession().api, profileId, {
        ...values,
        file,
        expectedVersion: existing?.version ?? 0,
      });
      onPublish(next);
    } catch (error) {
      setProblem(problemFrom(error));
    }
  }
  return { file, setFile, problem, form, publish };
}

export function VenueLayoutImport(props: ImportProps) {
  const { t } = useTranslation('ticket-sales');
  const { file, setFile, problem, form, publish } = useLayoutImport(props);
  const isTooLarge = Boolean(file && file.size > CSV_LIMIT_BYTES);
  const { errors, isSubmitting } = form.formState;
  return (
    <details>
      <summary className="min-h-11 cursor-pointer">{t('inventory.csv')}</summary>
      <p>{t('inventory.csvHelp')}</p>
      <a
        className="underline"
        download="ticket-layout.csv"
        href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
      >
        {t('inventory.csvTemplate')}
      </a>
      {problem ? <ProblemAlert problem={problem} refused={() => t('inventory.failed')} /> : null}
      <AppForm onSubmit={form.handleSubmit(publish)}>
        <TextInputField
          readOnly={Boolean(props.existing)}
          label={t('inventory.layoutKey')}
          {...form.register('key')}
        />
        <TextInputField label={t('inventory.layoutName')} {...form.register('name')} />
        <label className="grid gap-1">
          {t('inventory.csvFile')}
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        {isTooLarge ? <p role="alert">{t('inventory.csvSize')}</p> : null}
        {Object.keys(errors).length ? <p role="alert">{t('inventory.failed')}</p> : null}
        <SubmitButton isSubmitting={isSubmitting || !file || isTooLarge}>
          {t('inventory.publishLayout')}
        </SubmitButton>
      </AppForm>
    </details>
  );
}
