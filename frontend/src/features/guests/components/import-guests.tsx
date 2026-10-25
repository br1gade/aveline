import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useRevalidator } from 'react-router';

import { browserSession } from '@/api/session';
import { AppForm, ProblemAlert, SubmitButton, TextInputField } from '@/ui/app-form';

import { importGuests } from '../api';
import type { GuestImportsData } from '../load';
import { guestListPath } from '../paths';
import { refusalOf, useRefusedText, type Refusal } from '../refusals';
import { importFormSchema, type ImportFormValues } from '../schemas';
import type { ImportResult } from '../types';
import { useGuestFieldText } from '../use-field-text';
import { ImportHistory } from './import-history';
import { ImportResultView } from './import-result';

interface ImportFormProps {
  eventId: string;
  hasResult: boolean;
  onResult: (result: ImportResult) => void;
}

/**
 * The upload (design PD-45). The file's size is checked before it is sent, with the backend's own
 * limit, which refuses a larger file with a 413 as it arrives. A second import while one runs is a
 * 409; the button stays disabled while this one does.
 */
function ImportForm({ eventId, hasResult, onResult }: ImportFormProps) {
  const { t } = useTranslation('guests');
  const fieldText = useGuestFieldText();
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const refused = useRefusedText('import', false);
  const form = useForm<ImportFormValues>({ resolver: zodResolver(importFormSchema) });
  const { errors, isSubmitting } = form.formState;
  const fileError =
    errors.files?.message === 'required' ? t('fields.errors.chooseFile') : fieldText(errors.files);

  const onSubmit = async ({ files }: ImportFormValues) => {
    const file = files[0];
    if (!file) return;
    setRefusal(null);
    try {
      onResult(await importGuests(browserSession().api, eventId, file));
      form.reset();
    } catch (error) {
      setRefusal(refusalOf(error, 'import'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {refusal ? <ProblemAlert problem={refusal.problem} refused={refused} /> : null}
      <AppForm onSubmit={form.handleSubmit(onSubmit)}>
        <TextInputField
          label={t('fields.file')}
          type="file"
          accept=".csv,text/csv"
          error={fileError}
          {...form.register('files')}
        />
        <SubmitButton isSubmitting={isSubmitting} className="w-auto self-start">
          {isSubmitting
            ? t('import.importing')
            : t(hasResult ? 'import.submitAgain' : 'import.submit')}
        </SubmitButton>
      </AppForm>
    </div>
  );
}

/**
 * Importing a guest list from a spreadsheet (docs/API.md §6, "Importing a guest list"). The result
 * lives only in this page's state, never in history or storage: it may quote a mistyped address.
 */
export function ImportGuests({ data }: { data: GuestImportsData }) {
  const { t } = useTranslation('guests');
  const { revalidate } = useRevalidator();
  const { event, history } = data;
  const [result, setResult] = useState<ImportResult | null>(null);
  const showResult = (next: ImportResult) => {
    setResult(next);
    void revalidate();
  };
  return (
    <section className="flex flex-col gap-5">
      <Link
        to={guestListPath(event.id)}
        className="text-primary self-start underline underline-offset-4 hover:no-underline"
      >
        {t('import.back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">
          {t('import.title')}
        </h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      <div className="flex max-w-[40rem] flex-col gap-2">
        <p className="m-0">{t('import.lead')}</p>
        <p className="m-0">{t('import.columns')}</p>
        <p className="m-0">{t('import.excel')}</p>
        <p className="text-muted-foreground m-0 text-sm">{t('import.again')}</p>
      </div>
      <div className="grid items-start gap-5 md:grid-cols-[1fr_18rem]">
        {result ? <ImportResultView eventId={event.id} result={result} /> : null}
        <ImportForm eventId={event.id} hasResult={result !== null} onResult={showResult} />
      </div>
      <ImportHistory history={history} event={event} />
    </section>
  );
}
