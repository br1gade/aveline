import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { Loaded } from '@/api/loaded';
import { browserSession } from '@/api/session';
import {
  AppForm,
  type PageActions,
  SelectField,
  SubmitButton,
  TextInputField,
  useLeaveGuard,
} from '@/ui/app-form';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/kit/alert-dialog';
import { Button } from '@/ui/kit/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/kit/dialog';
import { NativeSelectOption } from '@/ui/kit/native-select';

import { addHall, updateHall } from '../api';
import { hallRefusalOf, type HallRefusal } from '../directory';
import { hallUpdatePayload, newHallPayload } from '../payload';
import { hallFormSchema, type HallFormValues } from '../schemas';
import type { DirectoryHall, HallOperator } from '../types';
import { useVenueFieldText } from '../use-field-text';
import { HallProblem } from './hall-problem';

interface DialogContext {
  page: PageActions;
  onClose: () => void;
  /** Back to what opened the dialog, when nothing was done. */
  restoreFocus: (closing: Event) => void;
}

/**
 * A write inside a dialog. It can't be dismissed while the request runs, so a refusal always has
 * somewhere to show. Resolves to the refusal, if any.
 */
function useHallAction({ page, onClose, restoreFocus }: DialogContext) {
  const [isBusy, setIsBusy] = useState(false);
  const [refusal, setRefusal] = useState<HallRefusal | null>(null);
  const isDone = useRef(false);
  const onCloseAutoFocus = (closing: Event) =>
    isDone.current ? page.focusStatus(closing) : restoreFocus(closing);
  const onOpenChange = (isOpen: boolean) => {
    if (!isOpen && !isBusy) onClose();
  };
  const run = async (action: () => Promise<void>, message: string) => {
    setRefusal(null);
    setIsBusy(true);
    try {
      await action();
      await page.done(message);
      isDone.current = true;
      onClose();
      return null;
    } catch (error) {
      const found = hallRefusalOf(error);
      setRefusal(found);
      setIsBusy(false);
      if (found.isStale) page.reload();
      return found;
    }
  };
  return { isBusy, refusal, run, onCloseAutoFocus, onOpenChange };
}

type HallForm = ReturnType<typeof useForm<HallFormValues>>;

const NEW_HALL: HallFormValues = { name: '', address: '', city: '', capacity: '', operatorId: '' };

function valuesOf(hall: DirectoryHall | null): HallFormValues {
  if (!hall) return NEW_HALL;
  return {
    name: hall.name,
    address: hall.address,
    city: hall.city ?? '',
    capacity: hall.capacity ? String(hall.capacity) : '',
    operatorId: hall.operatorId ?? '',
  };
}

/** A role refused the vendors keeps the hall's link as it is, and is told so. */
function OperatorField({ operators, form }: { operators: Loaded<HallOperator[]>; form: HallForm }) {
  const { t } = useTranslation('venues');
  if (operators.kind !== 'ready') {
    return <p className="text-muted-foreground m-0 text-sm">{t('directory.form.noOperators')}</p>;
  }
  return (
    <SelectField
      label={t('directory.form.operator')}
      help={t('directory.form.operatorHelp')}
      {...form.register('operatorId')}
    >
      <NativeSelectOption value="">{t('directory.noOperator')}</NativeSelectOption>
      {operators.value.map((operator) => (
        <NativeSelectOption key={operator.id} value={operator.id}>
          {operator.name}
        </NativeSelectOption>
      ))}
    </SelectField>
  );
}

interface HallDialogProps extends DialogContext {
  /** The hall to correct; `null` to add one. */
  hall: DirectoryHall | null;
  operators: Loaded<HallOperator[]>;
}

function HallFields({ form }: { form: HallForm }) {
  const { t } = useTranslation('venues');
  const fieldText = useVenueFieldText();
  const { errors } = form.formState;
  return (
    <>
      <TextInputField
        label={t('directory.form.name')}
        error={fieldText(errors.name)}
        {...form.register('name')}
      />
      <TextInputField
        label={t('directory.form.address')}
        error={fieldText(errors.address)}
        {...form.register('address')}
      />
      <TextInputField
        label={t('directory.form.city')}
        error={fieldText(errors.city)}
        {...form.register('city')}
      />
      <TextInputField
        label={t('directory.form.capacity')}
        inputMode="numeric"
        error={fieldText(errors.capacity)}
        {...form.register('capacity')}
      />
    </>
  );
}

/** Adds, or sends only what changed and nothing when nothing did. */
function useHallSave(
  hall: DirectoryHall | null,
  initial: HallFormValues,
  form: HallForm,
  context: DialogContext,
) {
  const { t } = useTranslation('venues');
  const action = useHallAction(context);
  const write = (values: HallFormValues) => {
    const { api } = browserSession();
    if (!hall) {
      return action.run(
        () => addHall(api, newHallPayload(values)),
        t('directory.status.added', { name: values.name }),
      );
    }
    const body = hallUpdatePayload(initial, values);
    if (Object.keys(body).length === 0) {
      context.onClose();
      return null;
    }
    return action.run(
      () => updateHall(api, hall.id, body),
      t('directory.status.saved', { name: values.name }),
    );
  };
  const save = async (values: HallFormValues) => {
    const refusal = await write(values);
    // The reload takes this operator off the list, while the form would still hold and resend it.
    if (refusal?.kind === 'operatorRefused') form.setValue('operatorId', '');
  };
  return { ...action, save };
}

/** Adding a hall or correcting one, its operator included (design PD-102). */
export function HallDialog({ hall, operators, ...context }: HallDialogProps) {
  const { t } = useTranslation('venues');
  const [initial] = useState(() => valuesOf(hall));
  const schema = useMemo(() => hallFormSchema(initial), [initial]);
  const form = useForm<HallFormValues>({ resolver: zodResolver(schema), defaultValues: initial });
  useLeaveGuard(form);
  const { isBusy, refusal, save, onCloseAutoFocus, onOpenChange } = useHallSave(
    hall,
    initial,
    form,
    context,
  );
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>
            {hall
              ? t('directory.form.editTitle', { name: hall.name })
              : t('directory.form.addTitle')}
          </DialogTitle>
          <DialogDescription>{t('directory.form.body')}</DialogDescription>
        </DialogHeader>
        {refusal ? <HallProblem refusal={refusal} /> : null}
        <AppForm onSubmit={form.handleSubmit(save)}>
          <HallFields form={form} />
          <OperatorField operators={operators} form={form} />
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={isBusy} onClick={context.onClose}>
              {t('directory.form.cancel')}
            </Button>
            <SubmitButton isSubmitting={isBusy} className="w-auto">
              {isBusy ? t('directory.form.saving') : t('directory.form.save')}
            </SubmitButton>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}

/** Retiring asks first: no read shows a retired hall again, so it can't be brought back (FR-91). */
export function RetireHallDialog({ hall, ...context }: DialogContext & { hall: DirectoryHall }) {
  const { t } = useTranslation('venues');
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useHallAction(context);
  const retire = () =>
    run(
      () => updateHall(browserSession().api, hall.id, { isActive: false }),
      t('directory.status.retired', { name: hall.name }),
    );
  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('directory.retireDialog.title', { name: hall.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('directory.retireDialog.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        {refusal ? <HallProblem refusal={refusal} /> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>{t('directory.form.cancel')}</AlertDialogCancel>
          <Button variant="destructive" disabled={isBusy} onClick={() => void retire()}>
            {t('directory.retireDialog.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
