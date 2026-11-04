import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate, useRevalidator } from 'react-router';

import { browserSession } from '@/api/session';
import { AppForm, SelectField, SubmitButton, useLeaveGuard, WordedRefusal } from '@/ui/app-form';

import { createInvitation, listTemplates } from '../api';
import { designPath } from '../paths';
import { addRefusalOf, type AddRefusal } from '../refusals';
import type { DesignTemplate } from '../types';

interface TemplatesRead {
  templates: DesignTemplate[];
  /** Not read at all, which the page says; an empty list read is not that. */
  hasFailed: boolean;
}

/**
 * Without the list, the backend picks the first active template when none is named. Read again
 * whenever `generation` moves, as after a template withdrawn meanwhile.
 */
function useTemplates(eventId: string, generation: number): TemplatesRead {
  const [read, setRead] = useState<TemplatesRead>({ templates: [], hasFailed: false });
  useEffect(() => {
    let isCurrent = true;
    const settle = (next: TemplatesRead) => {
      if (isCurrent) setRead(next);
    };
    listTemplates(browserSession().api, eventId).then(
      (templates) => settle({ templates, hasFailed: false }),
      () => settle({ templates: [], hasFailed: true }),
    );
    return () => {
      isCurrent = false;
    };
  }, [eventId, generation]);
  return read;
}

/**
 * Adding an invitation to an event that has none (docs/API.md §6; design PD-132), which only an
 * event created before any template existed can lack. Every role is offered it, and a refusal is
 * worded (FR-6). An authored template's own preview comes later, on choosing it in the look.
 */
export function AddInvitation({ eventId }: { eventId: string }) {
  const { t } = useTranslation('design');
  const [generation, setGeneration] = useState(0);
  const { templates, hasFailed } = useTemplates(eventId, generation);
  const [refusal, setRefusal] = useState<AddRefusal | null>(null);
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const form = useForm<{ templateKey: string }>({ defaultValues: { templateKey: '' } });
  useLeaveGuard(form);

  const onSubmit = async ({ templateKey }: { templateKey: string }) => {
    setRefusal(null);
    try {
      await createInvitation(browserSession().api, eventId, templateKey || undefined);
      form.reset({ templateKey });
      await navigate(designPath(eventId));
      await revalidate();
    } catch (error) {
      const found = addRefusalOf(error);
      setRefusal(found);
      if (found.kind === 'templateGone') {
        form.reset({ templateKey: '' });
        setGeneration((count) => count + 1);
      }
      if (found.isStale) await revalidate();
    }
  };
  return (
    <AppForm
      onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
      className="max-w-[34rem]"
    >
      {refusal ? (
        <WordedRefusal
          message={t(`add.refused.${refusal.kind}`)}
          english={refusal.sentence}
          requestId={refusal.requestId}
        />
      ) : null}
      {templates.length > 0 ? (
        <SelectField label={t('add.template')} {...form.register('templateKey')}>
          <option value="">{t('add.firstTemplate')}</option>
          {templates.map(({ key, name }) => (
            <option key={key} value={key} lang="en">
              {name}
            </option>
          ))}
        </SelectField>
      ) : null}
      {hasFailed ? <p className="m-0">{t('add.noList')}</p> : null}
      <SubmitButton isSubmitting={form.formState.isSubmitting} className="self-start">
        {t('add.submit')}
      </SubmitButton>
    </AppForm>
  );
}
