import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useFieldArray, useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { problemFrom, type Problem } from '@/api/problems';
import { browserSession } from '@/api/session';
import { AppForm, ProblemAlert, SubmitButton, TextInputField, useLeaveGuard } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { NativeSelect, NativeSelectOption } from '@/ui/kit/native-select';

import { publishVenueLayout, type VenueLayout } from '../inventory-api';

const key = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const name = z.string().trim().min(1).max(100);
const row = z.object({ label: z.string().trim().max(16), seats: z.string().max(1700) });
const section = z.object({
  key,
  name,
  mode: z.enum(['NUMBERED', 'UNNUMBERED']),
  capacity: z.string(),
  rows: z.array(row).max(100),
});
const editorSchema = z.object({ key, name, sections: z.array(section).min(1).max(40) });
type Values = z.infer<typeof editorSchema>;
type LayoutForm = UseFormReturn<Values>;
type LayoutSection = Values['sections'][number];

const emptyRow = { label: '', seats: '' };
const emptySection: LayoutSection = {
  key: '',
  name: '',
  mode: 'NUMBERED',
  capacity: '',
  rows: [emptyRow],
};

function initial(existing?: VenueLayout): Values {
  if (!existing) return { key: '', name: '', sections: [emptySection] };
  return {
    key: existing.key,
    name: existing.name,
    sections: existing.sections.map((entry) =>
      entry.mode === 'NUMBERED'
        ? {
            ...entry,
            capacity: '',
            rows: entry.rows.map(({ label, seats }) => ({ label, seats: seats.join(', ') })),
          }
        : { ...entry, capacity: String(entry.capacity), rows: [emptyRow] },
    ),
  };
}

function sectionBody({ key, name, mode, capacity, rows }: LayoutSection) {
  if (mode === 'UNNUMBERED') return { key, name, mode, capacity: Number(capacity) };
  return {
    key,
    name,
    mode,
    rows: rows.map(({ label, seats }) => ({
      label,
      seats: seats
        .split(',')
        .map((seat) => seat.trim())
        .filter(Boolean),
    })),
  };
}

function RowFields({ form, index }: { form: LayoutForm; index: number }) {
  const { t } = useTranslation('ticket-sales');
  const path = `sections.${index}.rows` as const;
  const rows = useFieldArray({ control: form.control, name: path });
  return (
    <div className="grid gap-3">
      {rows.fields.map((row, position) => (
        <div key={row.id} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <TextInputField
            label={t('inventory.row')}
            {...form.register(`${path}.${position}.label`)}
          />
          <TextInputField
            label={t('inventory.seats')}
            {...form.register(`${path}.${position}.seats`)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={rows.fields.length === 1}
            onClick={() => rows.remove(position)}
          >
            {t('inventory.remove')}
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={rows.fields.length >= 100}
        onClick={() => rows.append(emptyRow)}
      >
        {t('inventory.addRow')}
      </Button>
    </div>
  );
}

function SectionFields({
  form,
  index,
  onRemove,
}: {
  form: LayoutForm;
  index: number;
  onRemove: () => void;
}) {
  const { t } = useTranslation('ticket-sales');
  const path = `sections.${index}` as const;
  const mode = useWatch({ control: form.control, name: `${path}.mode` });
  return (
    <fieldset className="border-border grid gap-3 border p-3">
      <legend>
        {t('inventory.sectionName')} {index + 1}
      </legend>
      <TextInputField label={t('inventory.sectionKey')} {...form.register(`${path}.key`)} />
      <TextInputField label={t('inventory.sectionName')} {...form.register(`${path}.name`)} />
      <label className="grid gap-1">
        {t('inventory.sectionName')}
        <NativeSelect {...form.register(`${path}.mode`)}>
          <NativeSelectOption value="NUMBERED">{t('inventory.numbered')}</NativeSelectOption>
          <NativeSelectOption value="UNNUMBERED">{t('inventory.zone')}</NativeSelectOption>
        </NativeSelect>
      </label>
      {mode === 'NUMBERED' ? (
        <RowFields form={form} index={index} />
      ) : (
        <TextInputField
          inputMode="numeric"
          label={t('inventory.capacity')}
          {...form.register(`${path}.capacity`)}
        />
      )}
      <Button type="button" variant="outline" onClick={onRemove}>
        {t('inventory.remove')}
      </Button>
    </fieldset>
  );
}

function EditorProblem({ problem }: { problem: Problem | null }) {
  const { t } = useTranslation('ticket-sales');
  return problem ? <ProblemAlert problem={problem} refused={() => t('inventory.failed')} /> : null;
}

interface EditorProps {
  profileId: string;
  existing?: VenueLayout | undefined;
  onPublish: (layout: VenueLayout) => void;
}

function useLayoutEditor({ profileId, existing, onPublish }: EditorProps) {
  const [problem, setProblem] = useState<Problem | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(editorSchema),
    defaultValues: initial(existing),
  });
  useLeaveGuard(form);
  const sections = useFieldArray({ control: form.control, name: 'sections' });
  async function publish({ key, name, sections }: Values) {
    setProblem(null);
    try {
      onPublish(
        await publishVenueLayout(browserSession().api, profileId, {
          key,
          name,
          expectedVersion: existing?.version ?? 0,
          sections: sections.map(sectionBody),
        }),
      );
    } catch (error) {
      setProblem(problemFrom(error));
    }
  }
  return { form, sections, publish, problem };
}

export function VenueLayoutEditor({ profileId, existing, onPublish }: EditorProps) {
  const { t } = useTranslation('ticket-sales');
  const { form, sections, publish, problem } = useLayoutEditor({ profileId, existing, onPublish });
  return (
    <details className="grid gap-3">
      <summary className="min-h-11 cursor-pointer">{t('inventory.editor')}</summary>
      <EditorProblem problem={problem} />
      <AppForm onSubmit={form.handleSubmit(publish)}>
        <TextInputField
          readOnly={Boolean(existing)}
          label={t('inventory.layoutKey')}
          {...form.register('key')}
        />
        <TextInputField label={t('inventory.layoutName')} {...form.register('name')} />
        {sections.fields.map((section, index) => (
          <SectionFields
            key={section.id}
            form={form}
            index={index}
            onRemove={() => sections.remove(index)}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={sections.fields.length >= 40}
          onClick={() => sections.append(emptySection)}
        >
          {t('inventory.addSection')}
        </Button>
        {Object.keys(form.formState.errors).length ? (
          <p role="alert">{t('inventory.failed')}</p>
        ) : null}
        <SubmitButton isSubmitting={form.formState.isSubmitting}>
          {t('inventory.publishLayout')}
        </SubmitButton>
      </AppForm>
    </details>
  );
}
