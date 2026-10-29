import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { problemFrom } from '@/api/problems';
import { browserSession } from '@/api/session';
import { AppForm, SubmitButton, TextInputField, type PageActions } from '@/ui/app-form';

import { updateAltText } from '../api';
import { altTextEdit } from '../payload';
import { isStaleRefusal } from '../refusals';
import { altTextSchema } from '../schemas';
import { refusedProperties } from '../server-errors';
import type { LibraryItem } from '../types';
import { useFieldText } from '../use-field-text';
import { useLanguageLabel } from './built-in-questions';
import { DesignRefusal, type DesignRefusalState } from './design-parts';

interface AltTextValues {
  altText: Record<string, string>;
}

const schema = z.object({ altText: altTextSchema });

interface AltTextFormProps {
  item: LibraryItem;
  locales: readonly string[];
  eventId: string;
  page: PageActions;
}

/**
 * What the picture shows, for guests who cannot see it, in each of the event's languages
 * (design PD-62): accessibility text in the wrong language is not accessible. One language at a
 * time is sent, an emptied one removed.
 */
export function AltTextForm({ item, locales, eventId, page }: AltTextFormProps) {
  const { t } = useTranslation('design');
  const languageLabel = useLanguageLabel();
  const fieldText = useFieldText();
  const [baseline] = useState<AltTextValues>(() => ({
    altText: Object.fromEntries(locales.map((locale) => [locale, item.altText[locale] ?? ''])),
  }));
  const form = useForm<AltTextValues>({ resolver: zodResolver(schema), defaultValues: baseline });
  const [refusal, setRefusal] = useState<DesignRefusalState | null>(null);
  const save = async (values: AltTextValues) => {
    setRefusal(null);
    const body = altTextEdit(item.altText, baseline.altText, values.altText);
    if (Object.keys(body).length === 0) return page.done(t('media.nothing'));
    try {
      await updateAltText(browserSession().api, eventId, item.id, body);
      await page.done(t('media.described'));
    } catch (error) {
      if (refusedProperties(error).includes('altText')) {
        form.setError('altText', { type: 'server', message: 'refused' });
      }
      setRefusal({ action: 'altText', problem: problemFrom(error) });
      if (isStaleRefusal('altText', error)) page.reload();
    }
  };
  const errors = form.formState.errors.altText;
  return (
    <AppForm onSubmit={form.handleSubmit(save)} className="gap-3">
      <p className="text-muted-foreground m-0 text-sm">{t('media.describeHelp')}</p>
      {refusal ? <DesignRefusal refusal={refusal} /> : null}
      {locales.map((locale) => (
        <TextInputField
          key={locale}
          lang={locale}
          label={languageLabel(locale)}
          autoComplete="off"
          error={fieldText(errors?.[locale] ?? (errors?.message ? errors : undefined))}
          {...form.register(`altText.${locale}`)}
        />
      ))}
      <SubmitButton isSubmitting={form.formState.isSubmitting} className="w-auto self-start">
        {form.formState.isSubmitting ? t('media.saving') : t('media.saveDescription')}
      </SubmitButton>
    </AppForm>
  );
}
