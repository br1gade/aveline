import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { AppForm, ErrorLine, SubmitButton, TextInputField, useLeaveGuard } from '@/ui/app-form';

import { WALK_IN_RUNNING } from '../arrival';
import type { DoorRefusal } from '../refusals';
import { walkInSchema, type WalkInValues } from '../walk-in';
import { useRefusalWords } from './door-result';
import type { Door } from './use-door';

const EMPTY: WalkInValues = { firstName: '', lastName: '' };

/** Why they weren't added. With no answer they may have been, so the list is searched first. */
function WalkInRefusal({ refusal }: { refusal: DoorRefusal | null }) {
  const { t } = useTranslation('door');
  const refusalWords = useRefusalWords();
  const id = useId();
  return (
    <div role="alert">
      {refusal ? (
        <ErrorLine id={id}>
          {refusal.kind === 'noAnswer' ? t('walkIn.mayBeAdded') : refusalWords(refusal)}
        </ErrorLine>
      ) : null}
    </div>
  );
}

/**
 * Someone not on the list (design PD-148): added with the guest list's own call, then checked in,
 * the result shown where every arrival's is. Folded away until asked for, so the search stays the
 * door's first thing. A refusal to add them stays here, with what was typed.
 */
export function WalkInForm({ door }: { door: Door }) {
  const { t } = useTranslation('door');
  const [isOpen, setIsOpen] = useState(false);
  const isAdding = door.state.running === WALK_IN_RUNNING;
  const [refusal, setRefusal] = useState<DoorRefusal | null>(null);
  const form = useForm<WalkInValues>({
    resolver: zodResolver(walkInSchema),
    defaultValues: EMPTY,
  });
  useLeaveGuard(form);
  const { errors, isSubmitting } = form.formState;
  const fieldError = (field: keyof WalkInValues) => {
    const code = errors[field]?.message;
    return code === 'required' || code === 'tooLong' ? t(`walkIn.errors.${code}`) : undefined;
  };
  const add = async (values: WalkInValues) => {
    const refused = await door.actions.walkIn(values);
    setRefusal(refused);
    if (refused) return;
    form.reset(EMPTY);
    setIsOpen(false);
  };
  return (
    <details
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      className="border-border border p-4"
    >
      <summary className="min-h-11 cursor-pointer py-2 font-medium">{t('walkIn.open')}</summary>
      <p className="m-0 mb-3 text-sm">{t('walkIn.help')}</p>
      <AppForm onSubmit={form.handleSubmit(add)}>
        <WalkInRefusal refusal={refusal} />
        <TextInputField
          label={t('walkIn.firstName')}
          autoComplete="off"
          error={fieldError('firstName')}
          {...form.register('firstName')}
        />
        <TextInputField
          label={t('walkIn.lastName')}
          autoComplete="off"
          error={fieldError('lastName')}
          {...form.register('lastName')}
        />
        <SubmitButton
          isSubmitting={isSubmitting || door.state.running !== null}
          className="h-auto min-h-12 py-2 whitespace-normal pointer-coarse:h-auto pointer-coarse:min-h-12"
        >
          {t(isSubmitting || isAdding ? 'walkIn.adding' : 'walkIn.submit')}
        </SubmitButton>
      </AppForm>
    </details>
  );
}
