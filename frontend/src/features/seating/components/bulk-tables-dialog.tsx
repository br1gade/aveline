import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { AppForm, TextInputField } from '@/ui/app-form';

import { createTables } from '../api';
import { bulkTablesPayload } from '../payload';
import { refusalOf, type SeatingRefusal } from '../refusals';
import {
  bulkTablesSchema,
  MAX_TABLE_SEATS,
  MAX_TABLES_AT_ONCE,
  type BulkTablesInput,
  type BulkTablesValues,
} from '../schemas';
import { refusedTableFields, type TableFieldRefusal } from '../server-errors';
import { useTableFieldText } from '../use-field-text';
import { FormDialog, FormFooter } from './shared';
import { unplaced } from './table-dialog';
import type { SeatingHost } from './use-seating-host';

/** A duplicate name is refused as `name:` with the prefix (`rejectDuplicateName`): the prefix's. */
function bulkFieldsOf(refusals: readonly TableFieldRefusal[]) {
  return refusals.map(({ field, code }) => ({
    field: field === 'name' ? 'namePrefix' : field,
    code,
  }));
}

interface BulkProps {
  host: SeatingHost;
  venueId: string | null;
}

type BulkForm = UseFormReturn<BulkTablesInput, unknown, BulkTablesValues>;

/** One request for them all; a 400 goes under the field it names. */
function useBulkSubmit({ host, venueId }: BulkProps, form: BulkForm) {
  const { t } = useTranslation('seating');
  const [refusal, setRefusal] = useState<SeatingRefusal | null>(null);
  const submit = async (values: BulkTablesValues) => {
    setRefusal(null);
    try {
      const body = bulkTablesPayload(values, venueId);
      const created = await createTables(browserSession().api, host.eventId, body);
      await host.saved(t('status.tablesAdded', { count: created }));
    } catch (error) {
      const marked = bulkFieldsOf(refusedTableFields(error));
      for (const { field, code } of marked) form.setError(field, { message: code });
      const found = refusalOf(error, 'addTables');
      setRefusal(unplaced(found, marked.length));
      if (found.isStale) host.reload();
    }
  };
  return { submit, refusal };
}

/**
 * Several tables at once (design PD-68): twenty tables of ten is one request, numbered by the
 * backend after the highest number already used with that name in this plan.
 */
export function BulkTablesDialog({ host, venueId }: BulkProps) {
  const { t } = useTranslation('seating');
  const fieldText = useTableFieldText();
  const form = useForm<BulkTablesInput, unknown, BulkTablesValues>({
    resolver: zodResolver(bulkTablesSchema),
    defaultValues: { namePrefix: t('dialog.defaultPrefix'), count: '10', capacity: '10', zone: '' },
  });
  const { submit, refusal } = useBulkSubmit({ host, venueId }, form);
  const { errors, isSubmitting } = form.formState;
  const number = {
    type: 'number',
    inputMode: 'numeric',
    min: 1,
    className: 'max-w-[8rem]',
  } as const;
  return (
    <FormDialog host={host} title={t('dialog.bulkTitle')} refusal={refusal}>
      <AppForm onSubmit={form.handleSubmit(submit)}>
        <TextInputField
          label={t('dialog.prefix')}
          help={t('dialog.prefixHelp')}
          autoComplete="off"
          maxLength={40}
          error={fieldText(errors.namePrefix)}
          {...form.register('namePrefix')}
        />
        <TextInputField
          label={t('dialog.count')}
          max={MAX_TABLES_AT_ONCE}
          error={fieldText(errors.count)}
          {...number}
          {...form.register('count')}
        />
        <TextInputField
          label={t('dialog.capacityEach')}
          max={MAX_TABLE_SEATS}
          error={fieldText(errors.capacity)}
          {...number}
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
        <FormFooter
          isSubmitting={isSubmitting}
          label={isSubmitting ? t('dialog.adding') : t('dialog.bulkSubmit')}
        />
      </AppForm>
    </FormDialog>
  );
}
