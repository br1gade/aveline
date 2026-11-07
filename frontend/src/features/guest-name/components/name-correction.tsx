import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { createPublicApi } from '@/api/client';
import { isApiError } from '@/api/errors';
import { problemFrom } from '@/api/problems';
import { readPublicEnv } from '@/config/env';
import { useLeaveGuard } from '@/ui/app-form';
import { Button, Notice, useIsHydrated } from '@/ui';
import { TextField } from '@/ui/form';

import { correctName, type NameLink } from '../api';
import { nameChange } from '../payload';
import {
  NAME_LIMIT,
  nameSchema,
  type NameField,
  type NameFieldCode,
  type NameValues,
} from '../schemas';
import { refusedNameFields } from '../server-errors';
import type { CorrectedName, SavedName } from '../types';

/** Why a correction did not go through, beyond a field it names. */
type Refusal =
  | { kind: 'gone' }
  | { kind: 'rate-limited' }
  | { kind: 'unreachable' }
  | { kind: 'failed'; requestId: string | undefined };

export interface NameCorrectionProps {
  /** The name as the reply read holds it, both parts. */
  saved: SavedName;
  link: NameLink;
  /** The page's language, for the backend's own words. */
  locale: string;
  onCorrected: (corrected: CorrectedName) => void;
}

const CODES: readonly NameFieldCode[] = ['required', 'tooLong', 'invalid', 'refused'];

function isNameFieldCode(code: string | undefined): code is NameFieldCode {
  return CODES.some((known) => known === code);
}

function refusalOf(error: unknown): Refusal {
  if (isApiError(error) && error.status === 404) return { kind: 'gone' };
  const problem = problemFrom(error);
  if (problem.code === 'rate-limited' || problem.code === 'unreachable') {
    return { kind: problem.code };
  }
  return { kind: 'failed', requestId: problem.code === 'server' ? problem.requestId : undefined };
}

function RefusalNotice({ refusal }: { refusal: Refusal }) {
  const { t } = useTranslation('invitation');
  const words = {
    gone: t('personal.name.gone'),
    'rate-limited': t('personal.name.rateLimited'),
    unreachable: t('personal.name.unreachable'),
    failed: t('personal.name.failed'),
  }[refusal.kind];
  return (
    <Notice tone="error" role="alert">
      <p>{words}</p>
      {refusal.kind === 'failed' && refusal.requestId ? (
        <p className="text-ink-muted mt-1 text-sm select-all">
          {t('personal.name.reference', { id: refusal.requestId })}
        </p>
      ) : null}
    </Notice>
  );
}

function useCorrection(props: NameCorrectionProps, onDone: () => void) {
  const { saved, link, locale, onCorrected } = props;
  const api = useMemo(
    () => createPublicApi(readPublicEnv().VITE_API_BASE_URL, { getLanguage: () => locale }),
    [locale],
  );
  const form = useForm<NameValues>({
    resolver: zodResolver(nameSchema),
    defaultValues: { firstName: saved.firstName, lastName: saved.lastName ?? '' },
  });
  useLeaveGuard(form);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const send = async (values: NameValues) => {
    setRefusal(null);
    const body = nameChange(saved, values);
    if (!body) return onDone();
    try {
      onCorrected(await correctName(api, link, body));
      onDone();
    } catch (error) {
      const fields = isApiError(error) && error.status === 400 ? refusedNameFields(error) : [];
      fields.forEach((field) => form.setError(field, { message: 'refused' }));
      if (fields.length === 0) setRefusal(refusalOf(error));
    }
  };
  return { form, refusal, send };
}

function NameForm(props: NameCorrectionProps & { onClose: (isSaved: boolean) => void }) {
  const { t } = useTranslation('invitation');
  const isHydrated = useIsHydrated();
  const { form, refusal, send } = useCorrection(props, () => props.onClose(true));
  const { errors, isSubmitting } = form.formState;
  const errorText = (field: NameField) => {
    const code = errors[field]?.message;
    return isNameFieldCode(code)
      ? t(`personal.name.errors.${code}`, { limit: NAME_LIMIT })
      : undefined;
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    void form.handleSubmit(send)(event);
  };
  return (
    // `method="post"`: were the browser ever to send it itself, the name goes in a body (PD-41).
    <form method="post" noValidate onSubmit={submit} className="grid gap-4 pt-2">
      {refusal ? <RefusalNotice refusal={refusal} /> : null}
      <p className="text-text-muted m-0 text-sm leading-[22px]">{t('personal.name.help')}</p>
      <TextField
        label={t('personal.name.firstName')}
        autoComplete="given-name"
        error={errorText('firstName')}
        {...form.register('firstName')}
      />
      <TextField
        label={t('personal.name.lastName')}
        optionalText={t('personal.name.optional')}
        help={t('personal.name.lastNameHelp')}
        autoComplete="family-name"
        error={errorText('lastName')}
        {...form.register('lastName')}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          disabled={!isHydrated || isSubmitting}
          aria-busy={isSubmitting || undefined}
        >
          {isSubmitting ? t('personal.name.saving') : t('personal.name.save')}
        </Button>
        <Button variant="quiet" onClick={() => props.onClose(false)}>
          {t('personal.name.cancel')}
        </Button>
      </div>
    </form>
  );
}

/**
 * The link holder corrects their own first and last name (docs/API.md §4; design PD-64): a quiet
 * button under the household's names opens the form, prefilled from the saved reply. Once saved,
 * the page shows the name at once, from the answer, and a status line says so with the focus.
 */
export function NameCorrection(props: NameCorrectionProps) {
  const { t } = useTranslation('invitation');
  const formId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isSaved) statusRef.current?.focus();
  }, [isSaved]);
  const close = (saved: boolean) => {
    setIsOpen(false);
    setIsSaved(saved);
    if (!saved) openerRef.current?.focus();
  };
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        ref={openerRef}
        variant="quiet"
        aria-expanded={isOpen}
        aria-controls={formId}
        onClick={() => {
          setIsSaved(false);
          setIsOpen((open) => !open);
        }}
        className="-ml-2"
      >
        {t('personal.name.open')}
      </Button>
      <div id={formId} hidden={!isOpen} className="w-full">
        {isOpen ? <NameForm {...props} onClose={close} /> : null}
      </div>
      <p ref={statusRef} role="status" tabIndex={-1} className="text-text-muted m-0 text-sm">
        {isSaved ? t('personal.name.saved') : ''}
      </p>
    </div>
  );
}
