import { useId } from 'react';
import { useController } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { isLanguage } from '@/lib/i18n';
import { ErrorLine } from '@/ui/app-form';
import { Checkbox } from '@/ui/kit/checkbox';
import { FieldDescription, FieldLegend, FieldSet } from '@/ui/kit/field';
import { Label } from '@/ui/kit/label';
import { RadioGroup, RadioGroupItem } from '@/ui/kit/radio-group';

import { toggleLanguage } from '../form-model';
import { useEventFieldText } from '../use-field-text';
import type { EventForm } from './event-fields';

/** A language in its own name; a code Aveline does not offer is shown as the code. */
function useLanguageName(): (code: string) => string {
  const { t } = useTranslation('common');
  return (code) => (isLanguage(code) ? t(`language.${code}`) : code);
}

/** The ticked languages and the default, kept together: unticking the default moves it. */
function useLanguageChoice(form: EventForm, options: readonly string[]) {
  const locales = useController({ control: form.control, name: 'locales' });
  const defaultLocale = useController({ control: form.control, name: 'defaultLocale' });
  const toggle = (language: string, isTicked: boolean) => {
    const choice = { locales: locales.field.value, defaultLocale: defaultLocale.field.value };
    const next = toggleLanguage(choice, language, isTicked, options);
    locales.field.onChange(next.locales);
    defaultLocale.field.onChange(next.defaultLocale);
  };
  return { locales, defaultLocale, toggle };
}

type LanguageChoiceState = ReturnType<typeof useLanguageChoice>;

interface PartProps {
  id: string;
  choice: LanguageChoiceState;
}

function LanguageChecks({ id, choice, options }: PartProps & { options: readonly string[] }) {
  const { t } = useTranslation('events');
  const fieldText = useEventFieldText();
  const languageName = useLanguageName();
  const { locales, toggle } = choice;
  const error = fieldText(locales.fieldState.error);
  return (
    <FieldSet className="gap-2" aria-describedby={error ? `${id}-error` : `${id}-help`}>
      <FieldLegend variant="label">{t('fields.languages')}</FieldLegend>
      <FieldDescription id={`${id}-help`}>{t('fields.languagesHelp')}</FieldDescription>
      {options.map((language, index) => (
        <div key={language} className="flex min-h-11 items-center gap-3">
          <Checkbox
            id={`${id}-${language}`}
            ref={index === 0 ? locales.field.ref : undefined}
            checked={locales.field.value.includes(language)}
            onCheckedChange={(checked) => toggle(language, checked === true)}
            aria-invalid={error ? true : undefined}
          />
          <Label htmlFor={`${id}-${language}`} className="font-normal">
            {languageName(language)}
          </Label>
        </div>
      ))}
      {error ? <ErrorLine id={`${id}-error`}>{error}</ErrorLine> : null}
    </FieldSet>
  );
}

function DefaultLanguage({ id, choice }: PartProps) {
  const { t } = useTranslation('events');
  const fieldText = useEventFieldText();
  const languageName = useLanguageName();
  const { locales, defaultLocale } = choice;
  const error = fieldText(defaultLocale.fieldState.error);
  return (
    <FieldSet className="gap-2" aria-describedby={error ? `${id}-default-error` : undefined}>
      <FieldLegend variant="label">{t('fields.defaultLanguage')}</FieldLegend>
      <FieldDescription>{t('fields.defaultLanguageHelp')}</FieldDescription>
      <RadioGroup
        value={defaultLocale.field.value}
        onValueChange={defaultLocale.field.onChange}
        className="gap-1"
      >
        {locales.field.value.map((language) => (
          <div key={language} className="flex min-h-11 items-center gap-3">
            <RadioGroupItem value={language} id={`${id}-default-${language}`} />
            <Label htmlFor={`${id}-default-${language}`} className="font-normal">
              {languageName(language)}
            </Label>
          </div>
        ))}
      </RadioGroup>
      {error ? <ErrorLine id={`${id}-default-error`}>{error}</ErrorLine> : null}
    </FieldSet>
  );
}

/**
 * Checkboxes for the languages, then a radio for the default among those ticked (design PD-42).
 * With none ticked there is no default to choose.
 */
export function LanguageFields({ form, options }: { form: EventForm; options: readonly string[] }) {
  const id = useId();
  const choice = useLanguageChoice(form, options);
  return (
    <>
      <LanguageChecks id={id} choice={choice} options={options} />
      {choice.locales.field.value.length > 0 ? <DefaultLanguage id={id} choice={choice} /> : null}
    </>
  );
}
