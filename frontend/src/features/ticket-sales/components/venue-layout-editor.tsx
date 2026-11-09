import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import {
  useFieldArray,
  useForm,
  useWatch,
  type FieldError,
  type UseFormReturn,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { AppForm, SelectField, SubmitButton, TextInputField, useLeaveGuard } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { NativeSelectOption } from '@/ui/kit/native-select';

import { publishVenueLayout, type VenueLayout } from '../inventory-api';
import { inventoryRefusalOf, type InventoryRefusal } from '../inventory-refusals';
import {
  EMPTY_ROW,
  EMPTY_SECTION,
  layoutSchema,
  layoutValues,
  sectionBody,
  type LayoutValues,
} from '../layout-form';
import { InventoryProblem } from './inventory-problem';

type LayoutForm = UseFormReturn<LayoutValues>;

/** A field's mistake in words: the schema's message names which (`layout-form.ts`). */
function useFieldError() {
  const { t } = useTranslation('ticket-sales');
  return (error: FieldError | undefined) =>
    error?.message ? t(`inventory.errors.${error.message as 'key'}`) : undefined;
}

function RowFields({ form, index }: { form: LayoutForm; index: number }) {
  const { t } = useTranslation('ticket-sales');
  const errorOf = useFieldError();
  const path = `sections.${index}.rows` as const;
  const rows = useFieldArray({ control: form.control, name: path });
  const errors = form.formState.errors.sections?.[index]?.rows;
  return (
    <div className="grid gap-3">
      {rows.fields.map((row, position) => (
        <div key={row.id} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <TextInputField
            label={t('inventory.row')}
            error={errorOf(errors?.[position]?.label)}
            {...form.register(`${path}.${position}.label`)}
          />
          <TextInputField
            label={t('inventory.seats')}
            error={errorOf(errors?.[position]?.seats)}
            {...form.register(`${path}.${position}.seats`)}
          />
          <Button
            type="button"
            variant="outline"
            className="self-end"
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
        className="justify-self-start"
        disabled={rows.fields.length >= 100}
        onClick={() => rows.append(EMPTY_ROW)}
      >
        {t('inventory.addRow')}
      </Button>
    </div>
  );
}

function SectionFields({
  form,
  index,
  isOnly,
  onRemove,
}: {
  form: LayoutForm;
  index: number;
  isOnly: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation('ticket-sales');
  const errorOf = useFieldError();
  const path = `sections.${index}` as const;
  const mode = useWatch({ control: form.control, name: `${path}.mode` });
  const errors = form.formState.errors.sections?.[index];
  return (
    <fieldset className="border-border grid gap-3 border p-3">
      <legend>{t('inventory.sectionLegend', { number: index + 1 })}</legend>
      <TextInputField
        label={t('inventory.sectionKey')}
        error={errorOf(errors?.key)}
        {...form.register(`${path}.key`)}
      />
      <TextInputField
        label={t('inventory.sectionName')}
        error={errorOf(errors?.name)}
        {...form.register(`${path}.name`)}
      />
      <SelectField label={t('inventory.sectionMode')} {...form.register(`${path}.mode`)}>
        <NativeSelectOption value="NUMBERED">{t('inventory.numbered')}</NativeSelectOption>
        <NativeSelectOption value="UNNUMBERED">{t('inventory.zone')}</NativeSelectOption>
      </SelectField>
      {mode === 'NUMBERED' ? (
        <RowFields form={form} index={index} />
      ) : (
        <TextInputField
          inputMode="numeric"
          label={t('inventory.capacity')}
          error={errorOf(errors?.capacity)}
          {...form.register(`${path}.capacity`)}
        />
      )}
      <Button
        type="button"
        variant="outline"
        className="justify-self-start"
        disabled={isOnly}
        onClick={onRemove}
      >
        {t('inventory.remove')}
      </Button>
    </fieldset>
  );
}

interface EditorProps {
  profileId: string;
  existing?: VenueLayout | undefined;
  onPublish: (layout: VenueLayout) => void;
}

function useLayoutEditor({ profileId, existing, onPublish }: EditorProps) {
  const [refusal, setRefusal] = useState<InventoryRefusal | null>(null);
  const form = useForm<LayoutValues>({
    resolver: zodResolver(layoutSchema),
    defaultValues: layoutValues(existing),
  });
  useLeaveGuard(form);
  const sections = useFieldArray({ control: form.control, name: 'sections' });
  async function publish({ key, name, sections }: LayoutValues) {
    setRefusal(null);
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
      setRefusal(inventoryRefusalOf(error));
    }
  }
  return { form, sections, publish, refusal };
}

/**
 * A venue layout typed by hand: sections, then rows of seat labels or a zone's places. Publishing it
 * is Aveline's directory editors' (`directory:manage`); anyone else is told so (FR-6). A mistake in
 * a field shows on it; duplicates and the 5,000-seat total come back as the backend's sentence.
 */
export function VenueLayoutEditor({ profileId, existing, onPublish }: EditorProps) {
  const { t } = useTranslation('ticket-sales');
  const errorOf = useFieldError();
  const { form, sections, publish, refusal } = useLayoutEditor({ profileId, existing, onPublish });
  const { errors } = form.formState;
  return (
    <details className="grid gap-3">
      <summary className="min-h-11 cursor-pointer">{t('inventory.editor')}</summary>
      <InventoryProblem refusal={refusal} action="layout" />
      <AppForm onSubmit={form.handleSubmit(publish)}>
        <TextInputField
          readOnly={Boolean(existing)}
          label={t('inventory.layoutKey')}
          error={errorOf(errors.key)}
          {...form.register('key')}
        />
        <TextInputField
          label={t('inventory.layoutName')}
          error={errorOf(errors.name)}
          {...form.register('name')}
        />
        {sections.fields.map((section, index) => (
          <SectionFields
            key={section.id}
            form={form}
            index={index}
            isOnly={sections.fields.length === 1}
            onRemove={() => sections.remove(index)}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          className="justify-self-start"
          disabled={sections.fields.length >= 40}
          onClick={() => sections.append(EMPTY_SECTION)}
        >
          {t('inventory.addSection')}
        </Button>
        {Object.keys(errors).length ? <p role="alert">{t('inventory.errors.summary')}</p> : null}
        <SubmitButton isSubmitting={form.formState.isSubmitting}>
          {t('inventory.publishLayout')}
        </SubmitButton>
      </AppForm>
    </details>
  );
}
