import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { translatedLanguages, useLanguageName } from '@/lib/i18n';
import { TextInputField, TranslationFields } from '@/ui/app-form';
import { FieldDescription, FieldLegend, FieldSet } from '@/ui/kit/field';

import { EVENT_TRANSLATED } from '../form-model';
import { useEventFieldText } from '../use-field-text';
import type { EventForm } from './event-fields';

/** When it ends, optional, typed in the event's zone: both or neither (design PD-110). */
function EndFields({ form }: { form: EventForm }) {
  const { t } = useTranslation('events');
  const fieldText = useEventFieldText();
  const { errors } = form.formState;
  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label">{t('fields.end')}</FieldLegend>
      <FieldDescription>{t('fields.endHelp')}</FieldDescription>
      <div className="grid gap-5 min-[480px]:grid-cols-2">
        <TextInputField
          type="date"
          max="9999-12-31"
          label={t('fields.endDate')}
          error={fieldText(errors.endDate)}
          {...form.register('endDate')}
        />
        <TextInputField
          type="time"
          label={t('fields.endTime')}
          error={fieldText(errors.endTime)}
          {...form.register('endTime')}
        />
      </div>
    </FieldSet>
  );
}

/**
 * The host's names for the two sides, which the guest list sorts guests by. Guests reading another
 * language see its own names for them, set with its title and hosts (FR-96).
 */
function SideFields({ form }: { form: EventForm }) {
  const { t } = useTranslation('events');
  const fieldText = useEventFieldText();
  const { errors } = form.formState;
  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label">{t('fields.sides')}</FieldLegend>
      <FieldDescription>{t('fields.sidesHelp')}</FieldDescription>
      <TextInputField
        label={t('fields.sideA')}
        autoComplete="off"
        error={fieldText(errors.sideALabel)}
        {...form.register('sideALabel')}
      />
      <TextInputField
        label={t('fields.sideB')}
        autoComplete="off"
        error={fieldText(errors.sideBLabel)}
        {...form.register('sideBLabel')}
      />
    </FieldSet>
  );
}

/**
 * The title, hosts and sides in each ticked language but the default (design PD-109, FR-96). Guests
 * reading a language see its words here, else the plain ones: the backend has no step between.
 */
function EventTranslations({ form, stored }: { form: EventForm; stored: unknown }) {
  const { t } = useTranslation('events');
  const languageName = useLanguageName();
  const fieldText = useEventFieldText();
  const locales = useWatch({ control: form.control, name: 'locales' });
  const defaultLocale = useWatch({ control: form.control, name: 'defaultLocale' });
  const languages = translatedLanguages(locales, defaultLocale, stored, EVENT_TRANSLATED);
  const { errors } = form.formState;
  if (languages.length === 0) return null;
  return (
    <TranslationFields
      legend={t('fields.otherLanguages')}
      help={t('fields.otherLanguagesHelp')}
      languages={languages}
      languageName={languageName}
      fields={[
        { key: 'title' as const, label: (language) => t('fields.titleIn', { language }) },
        { key: 'hostsLabel' as const, label: (language) => t('fields.hostsIn', { language }) },
        { key: 'sideALabel' as const, label: (language) => t('fields.sideAIn', { language }) },
        { key: 'sideBLabel' as const, label: (language) => t('fields.sideBIn', { language }) },
      ]}
      inputProps={(language, field) => form.register(`translations.${language}.${field}`)}
      errorOf={(language, field) => fieldText(errors.translations?.[language]?.[field])}
      noteOf={(language) =>
        language === defaultLocale
          ? t('fields.defaultOverride', { language: languageName(language) })
          : undefined
      }
      error={fieldText(errors.translations)}
    />
  );
}

/**
 * Correcting shows the end, the sides and the other languages. Creating shows the end and the sides
 * only, and says the other languages' words come after: the backend takes no `translations` there
 * (FR-101).
 */
export function DetailFields({
  form,
  mode,
  stored,
}: {
  form: EventForm;
  mode: 'create' | 'edit';
  stored: unknown;
}) {
  const { t } = useTranslation('events');
  const locales = useWatch({ control: form.control, name: 'locales' });
  return (
    <>
      <EndFields form={form} />
      <SideFields form={form} />
      {mode === 'edit' ? <EventTranslations form={form} stored={stored} /> : null}
      {/* Said only while there are other languages to add words in. */}
      {mode === 'create' && locales.length > 1 ? (
        <p className="text-muted-foreground m-0 text-sm">{t('fields.languagesLater')}</p>
      ) : null}
    </>
  );
}
