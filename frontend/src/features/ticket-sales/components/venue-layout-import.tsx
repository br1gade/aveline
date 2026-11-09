import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import { browserSession } from '@/api/session';
import { AppForm, SubmitButton, TextInputField, useLeaveGuardWhen } from '@/ui/app-form';

import { importVenueLayout, type VenueLayout } from '../inventory-api';
import { inventoryRefusalOf, type InventoryRefusal } from '../inventory-refusals';
import { layoutIdentitySchema } from '../layout-form';
import { InventoryProblem } from './inventory-problem';

type Values = z.infer<typeof layoutIdentitySchema>;
/** The backend's own limit on an uploaded layout. */
const CSV_LIMIT_BYTES = 8 * 1024 * 1024;
const TEMPLATE =
  'section_key,section_name,mode,row,seat,capacity\n' +
  'balcony,Balcony,NUMBERED,B,12,\n' +
  'floor,Floor,UNNUMBERED,,,200\n';
const LINK =
  'text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline';

interface ImportProps {
  profileId: string;
  existing?: VenueLayout | undefined;
  onPublish: (layout: VenueLayout) => void;
}

function useLayoutImport({ profileId, existing, onPublish }: ImportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [refusal, setRefusal] = useState<InventoryRefusal | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(layoutIdentitySchema),
    defaultValues: { key: existing?.key ?? '', name: existing?.name ?? '' },
  });
  useLeaveGuardWhen(form.formState.isDirty || Boolean(file));
  async function publish(values: Values) {
    if (!file || file.size > CSV_LIMIT_BYTES) return;
    setRefusal(null);
    try {
      const next = await importVenueLayout(browserSession().api, profileId, {
        ...values,
        file,
        expectedVersion: existing?.version ?? 0,
      });
      onPublish(next);
    } catch (error) {
      setRefusal(inventoryRefusalOf(error));
    }
  }
  return { file, setFile, refusal, form, publish };
}

/**
 * A large venue layout from a CSV file, with a template to start from. Publishing it is Aveline's
 * directory editors' (FR-6); a file over the backend's 8 MiB is refused before it is sent.
 */
export function VenueLayoutImport(props: ImportProps) {
  const { t } = useTranslation('ticket-sales');
  const fileId = useId();
  const { file, setFile, refusal, form, publish } = useLayoutImport(props);
  const isTooLarge = Boolean(file && file.size > CSV_LIMIT_BYTES);
  const { errors, isSubmitting } = form.formState;
  const errorOf = (message: string | undefined) =>
    message ? t(`inventory.errors.${message as 'key'}`) : undefined;
  return (
    <details>
      <summary className="min-h-11 cursor-pointer">{t('inventory.csv')}</summary>
      <p>{t('inventory.csvHelp')}</p>
      <a
        className={LINK}
        download="ticket-layout.csv"
        href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
      >
        {t('inventory.csvTemplate')}
      </a>
      <InventoryProblem refusal={refusal} action="layout" />
      <AppForm onSubmit={form.handleSubmit(publish)}>
        <TextInputField
          readOnly={Boolean(props.existing)}
          label={t('inventory.layoutKey')}
          error={errorOf(errors.key?.message)}
          {...form.register('key')}
        />
        <TextInputField
          label={t('inventory.layoutName')}
          error={errorOf(errors.name?.message)}
          {...form.register('name')}
        />
        <div className="grid gap-1">
          <label htmlFor={fileId} className="text-sm font-medium">
            {t('inventory.csvFile')}
          </label>
          <input
            id={fileId}
            type="file"
            accept=".csv,text/csv"
            className="min-h-11"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>
        {isTooLarge ? <p role="alert">{t('inventory.csvSize')}</p> : null}
        <SubmitButton isSubmitting={isSubmitting || !file || isTooLarge}>
          {t('inventory.publishLayout')}
        </SubmitButton>
      </AppForm>
    </details>
  );
}
