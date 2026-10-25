import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { AppForm, ProblemAlert, SubmitButton, TextInputField } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/kit/dialog';

import { updateHousehold } from '../api';
import { householdFormValues } from '../form-model';
import { householdUpdatePayload } from '../payload';
import { badRequestMessages, refusalOf, useRefusedText, type Refusal } from '../refusals';
import {
  householdFormSchema,
  MAX_SEATS,
  type HouseholdFormInput,
  type HouseholdFormValues,
} from '../schemas';
import { refusedHouseholdFields } from '../server-errors';
import type { Household } from '../types';
import { useGuestFieldText } from '../use-field-text';
import type { DialogHostActions } from './use-list-dialogs';

interface HouseholdDialogProps {
  eventId: string;
  household: Household;
  host: DialogHostActions;
}

type HouseholdForm = UseFormReturn<HouseholdFormInput, unknown, HouseholdFormValues>;

/** Sends only what changed, and nothing when nothing did; a 400 goes under the field it names. */
function useHouseholdSubmit(
  { eventId, household, host }: HouseholdDialogProps,
  form: HouseholdForm,
) {
  const { t } = useTranslation('guests');
  const [initial] = useState<HouseholdFormValues>(() => ({
    name: household.name,
    seats: household.seatsAllotted,
  }));
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const submit = async (values: HouseholdFormValues) => {
    setRefusal(null);
    const body = householdUpdatePayload(initial, values);
    try {
      if (Object.keys(body).length === 0) return await host.saved(null);
      await updateHousehold(browserSession().api, eventId, household.id, body);
      await host.saved(t('status.householdSaved', { name: values.name }));
    } catch (error) {
      const marked = refusedHouseholdFields(badRequestMessages(error));
      for (const { field, code } of marked) form.setError(field, { type: 'server', message: code });
      const found = refusalOf(error, 'household', marked.length);
      setRefusal(found);
      if (found.isListStale) host.reload();
    }
  };
  return { submit, refusal };
}

/**
 * Renaming a household or changing its seats, never below the guests already named in it
 * (docs/API.md §6).
 */
export function HouseholdDialog(props: HouseholdDialogProps) {
  const { household, host } = props;
  const { t } = useTranslation('guests');
  const fieldText = useGuestFieldText();
  const schema = useMemo(() => householdFormSchema(household.seatsNamed), [household.seatsNamed]);
  const form = useForm<HouseholdFormInput, unknown, HouseholdFormValues>({
    resolver: zodResolver(schema),
    defaultValues: householdFormValues(household),
  });
  const { submit, refusal } = useHouseholdSubmit(props, form);
  const refused = useRefusedText('household', refusal?.isOnFields ?? false);
  const { errors, isSubmitting } = form.formState;
  const minimum = Math.max(1, household.seatsNamed);

  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : host.close())}>
      <DialogContent
        aria-describedby={undefined}
        className="sm:max-w-[30rem]"
        onCloseAutoFocus={host.restoreFocus}
      >
        <DialogHeader>
          <DialogTitle>{t('dialog.householdTitle', { name: household.name })}</DialogTitle>
        </DialogHeader>
        {refusal ? <ProblemAlert problem={refusal.problem} refused={refused} /> : null}
        <AppForm onSubmit={form.handleSubmit(submit)}>
          <TextInputField
            label={t('fields.householdName')}
            autoComplete="off"
            error={fieldText(errors.name)}
            {...form.register('name')}
          />
          <TextInputField
            label={t('fields.householdSeats')}
            help={t('fields.householdSeatsHelp', { count: minimum })}
            type="number"
            inputMode="numeric"
            min={minimum}
            max={MAX_SEATS}
            className="max-w-[8rem]"
            error={fieldText(errors.seats)}
            {...form.register('seats')}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t('dialog.cancel')}
              </Button>
            </DialogClose>
            <SubmitButton isSubmitting={isSubmitting} className="w-auto">
              {isSubmitting ? t('dialog.saving') : t('dialog.householdSubmit')}
            </SubmitButton>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}
