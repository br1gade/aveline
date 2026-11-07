import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { AppForm, SelectField, TextInputField, useLeaveGuard } from '@/ui/app-form';

import { createTable, updateTable } from '../api';
import { newTablePayload, tableUpdatePayload } from '../payload';
import { refusalOf, type SeatingRefusal } from '../refusals';
import {
  MAX_TABLE_SEATS,
  tableFormSchema,
  type TableFieldCode,
  type TableFormInput,
  type TableFormValues,
} from '../schemas';
import { refusedTableFields } from '../server-errors';
import type { SeatingTable } from '../types';
import { useTableFieldText } from '../use-field-text';
import type { Plan } from '../plans';
import { usePlanName } from './plan-tabs';
import { FormDialog, FormFooter } from './shared';
import type { SeatingHost } from './use-seating-host';

interface TableDialogProps {
  host: SeatingHost;
  /** The plan's venue, which a new table is added to; `null` for the plan without one. */
  venueId: string | null;
  /** The table to edit; absent to add one. */
  table?: SeatingTable;
  /** The plans it can move to, when editing (design PD-133). */
  plans?: readonly Plan[];
}

type TableForm = UseFormReturn<TableFormInput, unknown, TableFormValues>;

/** A 400 that named no field this form has: the backend's sentence says more than "check". */
export function unplaced(refusal: SeatingRefusal, marked: number): SeatingRefusal {
  return refusal.key === 'check' && marked === 0 ? { ...refusal, key: 'other' } : refusal;
}

function valuesOf(table: SeatingTable | undefined, venueId: string | null): TableFormValues {
  return {
    name: table?.name ?? '',
    capacity: table?.capacity ?? 10,
    zone: table?.zone ?? '',
    venueId: venueId ?? '',
  };
}

/** A table moves only with nobody at it: the backend refuses otherwise, which is said beforehand. */
function VenueField({
  plans,
  table,
  form,
}: {
  plans: readonly Plan[];
  table: SeatingTable;
  form: TableForm;
}) {
  const { t } = useTranslation('seating');
  const nameOf = usePlanName();
  const isOccupied = table.guests.length > 0 || table.released.length > 0;
  if (plans.length < 2) return null;
  return (
    <SelectField
      label={t('dialog.venue')}
      help={isOccupied ? t('dialog.venueOccupied') : t('dialog.venueHelp')}
      {...form.register('venueId')}
    >
      {plans.map((plan) => (
        <option key={plan.arrangement.id} value={plan.arrangement.venueId ?? ''}>
          {nameOf(plan)}
        </option>
      ))}
    </SelectField>
  );
}

/** Adds, or sends only what changed and nothing when nothing did; a 400 goes under its field. */
function useTableSubmit({ host, venueId, table }: TableDialogProps, form: TableForm) {
  const { t } = useTranslation('seating');
  const [initial] = useState(() => valuesOf(table, venueId));
  const [refusal, setRefusal] = useState<SeatingRefusal | null>(null);
  const write = async (values: TableFormValues): Promise<string | null> => {
    const { api } = browserSession();
    if (!table) {
      await createTable(api, host.eventId, newTablePayload(values, venueId));
      return t('status.tableAdded', { name: values.name });
    }
    const body = tableUpdatePayload(initial, values);
    if (Object.keys(body).length === 0) return null;
    await updateTable(api, host.eventId, table.id, body);
    return t('status.tableSaved', { name: values.name });
  };
  const submit = async (values: TableFormValues) => {
    setRefusal(null);
    try {
      await host.saved(await write(values));
    } catch (error) {
      const marked = refusedTableFields(error).filter(
        (refused): refused is { field: 'name' | 'capacity' | 'zone'; code: TableFieldCode } =>
          refused.field !== 'namePrefix' && refused.field !== 'count',
      );
      for (const { field, code } of marked) form.setError(field, { message: code });
      const found = refusalOf(error, table ? 'editTable' : 'addTable');
      setRefusal(unplaced(found, marked.length));
      if (found.isStale) host.reload();
    }
  };
  return { submit, refusal };
}

function useDialogWords(table: SeatingTable | undefined) {
  const { t } = useTranslation('seating');
  return table
    ? { title: t('dialog.editTitle', { name: table.name }), label: t('dialog.editSubmit') }
    : { title: t('dialog.addTitle'), label: t('dialog.addSubmit') };
}

/** One table's name, seats and area (design PD-68), never below the guests already seated. */
export function TableDialog(props: TableDialogProps) {
  const { host, table, venueId, plans } = props;
  const { t } = useTranslation('seating');
  const fieldText = useTableFieldText();
  const seated = table?.guests.length ?? 0;
  const schema = useMemo(() => tableFormSchema(seated), [seated]);
  const form = useForm<TableFormInput, unknown, TableFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { ...valuesOf(table, venueId), capacity: String(table?.capacity ?? 10) },
  });
  useLeaveGuard(form);
  const { submit, refusal } = useTableSubmit(props, form);
  const { errors, isSubmitting } = form.formState;
  const { title, label } = useDialogWords(table);
  return (
    <FormDialog host={host} title={title} refusal={refusal}>
      <AppForm onSubmit={form.handleSubmit(submit)}>
        <TextInputField
          label={t('dialog.name')}
          help={t('dialog.nameHelp')}
          autoComplete="off"
          maxLength={60}
          error={fieldText(errors.name)}
          {...form.register('name')}
        />
        <TextInputField
          label={t('dialog.capacity')}
          help={seated > 0 ? t('dialog.capacityHelp', { count: seated }) : undefined}
          type="number"
          inputMode="numeric"
          min={Math.max(1, seated)}
          max={MAX_TABLE_SEATS}
          className="max-w-[8rem]"
          error={fieldText(errors.capacity)}
          {...form.register('capacity')}
        />
        <TextInputField
          label={t('dialog.zone')}
          help={t('dialog.zoneHelp')}
          autoComplete="off"
          maxLength={60}
          error={fieldText(errors.zone)}
          {...form.register('zone')}
        />
        {table ? <VenueField plans={plans ?? []} table={table} form={form} /> : null}
        <FormFooter isSubmitting={isSubmitting} label={isSubmitting ? t('dialog.saving') : label} />
      </AppForm>
    </FormDialog>
  );
}
