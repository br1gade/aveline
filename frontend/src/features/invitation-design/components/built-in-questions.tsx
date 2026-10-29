import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useController, useFieldArray, useForm, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { problemFrom } from '@/api/problems';
import { browserSession } from '@/api/session';
import { BUILT_IN_FIELDS, type BuiltInField } from '@/features/invitation-renderer';
import { isLanguage } from '@/lib/i18n';
import { AppForm, ErrorLine, SubmitButton, TextInputField, type PageActions } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { Checkbox } from '@/ui/kit/checkbox';
import { FieldDescription, FieldLegend, FieldSet } from '@/ui/kit/field';
import { Label } from '@/ui/kit/label';
import { RadioGroup, RadioGroupItem } from '@/ui/kit/radio-group';

import { updateRsvpFields } from '../api';
import { rsvpFieldsFormValues, type RsvpFieldsValues } from '../form-model';
import { rsvpFieldsEdit } from '../payload';
import { isStaleRefusal } from '../refusals';
import { rsvpFieldsSchema } from '../schemas';
import { refusedProperties } from '../server-errors';
import type { Design } from '../types';
import { useFieldText } from '../use-field-text';
import { DesignRefusal, type DesignRefusalState } from './design-parts';

type FieldsForm = UseFormReturn<RsvpFieldsValues>;

const CHOICE_FIELDS: readonly BuiltInField[] = ['dietary', 'drinkPreference'];

/** A language's name as plain words, for a field's label. */
export function useLanguageLabel(): (code: string) => string {
  const { t } = useTranslation('common');
  return (code) => (isLanguage(code) ? t(`language.${code}`) : code);
}

interface ChoicesProps {
  form: FieldsForm;
  field: BuiltInField;
  locales: readonly string[];
}

/** Fixed choices, each with a label per language; guests send its key, counted as one answer. */
function Choices({ form, field, locales }: ChoicesProps) {
  const { t } = useTranslation('design');
  const languageLabel = useLanguageLabel();
  const fieldText = useFieldText();
  const choices = useFieldArray({ control: form.control, name: `${field}.choices` });
  const errors = form.formState.errors[field]?.choices;
  const empty = () => ({
    key: '',
    labels: Object.fromEntries(locales.map((locale) => [locale, ''])),
  });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground m-0 text-sm">{t('questions.choicesHelp')}</p>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {choices.fields.map((choice, position) => (
          <li key={choice.id} className="border-border flex flex-col gap-3 border-l-2 pl-4">
            {locales.map((locale) => (
              <TextInputField
                key={locale}
                lang={locale}
                label={t('questions.choiceIn', {
                  number: position + 1,
                  language: languageLabel(locale),
                })}
                autoComplete="off"
                {...form.register(`${field}.choices.${position}.labels.${locale}`)}
              />
            ))}
            {errors?.[position]?.labels ? (
              <ErrorLine id={`${field}-${position}-error`}>
                {fieldText(errors[position].labels)}
              </ErrorLine>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              className="self-start"
              onClick={() => choices.remove(position)}
            >
              {t('questions.removeChoice', { number: position + 1 })}
            </Button>
          </li>
        ))}
      </ol>
      {(errors?.root ?? errors?.message) ? (
        <ErrorLine id={`${field}-choices-error`}>{fieldText(errors.root ?? errors)}</ErrorLine>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => choices.append(empty())}
      >
        {t('questions.addChoice')}
      </Button>
    </div>
  );
}

function AnswerKind({ form, field, locales }: ChoicesProps) {
  const { t } = useTranslation('design');
  const id = useId();
  const kind = useController({ control: form.control, name: `${field}.hasChoices` });
  return (
    <>
      <RadioGroup
        aria-label={t('questions.answerKind')}
        value={kind.field.value ? 'choices' : 'text'}
        onValueChange={(value) => kind.field.onChange(value === 'choices')}
        className="gap-1"
      >
        {(['text', 'choices'] as const).map((value) => (
          <div key={value} className="flex min-h-11 items-center gap-3">
            <RadioGroupItem value={value} id={`${id}-${value}`} />
            <Label htmlFor={`${id}-${value}`} className="font-normal">
              {t(value === 'text' ? 'questions.freeText' : 'questions.fixedChoices')}
            </Label>
          </div>
        ))}
      </RadioGroup>
      {kind.field.value ? <Choices form={form} field={field} locales={locales} /> : null}
    </>
  );
}

function BuiltInFieldset({ form, field, locales }: ChoicesProps) {
  const { t } = useTranslation('design');
  const id = useId();
  const asked = useController({ control: form.control, name: `${field}.isEnabled` });
  const hasChoices = CHOICE_FIELDS.includes(field);
  return (
    <FieldSet className="border-border gap-3 border px-5 pt-3 pb-5">
      <FieldLegend className="px-1">{t(`questions.fields.${field}`)}</FieldLegend>
      {field === 'attribution' ? (
        <FieldDescription>{t('questions.attributionHelp')}</FieldDescription>
      ) : null}
      <div className="flex min-h-11 items-center gap-3">
        <Checkbox
          id={id}
          checked={asked.field.value}
          onCheckedChange={(checked) => asked.field.onChange(checked === true)}
        />
        <Label htmlFor={id} className="font-normal">
          {t('questions.ask')}
        </Label>
      </div>
      {hasChoices && asked.field.value ? (
        <AnswerKind form={form} field={field} locales={locales} />
      ) : null}
    </FieldSet>
  );
}

/**
 * The built-in questions (design PD-60): each asked or not, and dietary and drink as free text or
 * fixed choices. Attendance is always asked. One save sends only the questions changed.
 */
export function BuiltInQuestions({ design, page }: { design: Design; page: PageActions }) {
  const { t } = useTranslation('design');
  const { locales } = design.event;
  const [baseline] = useState(() => rsvpFieldsFormValues(design.rsvpFields, locales));
  const form = useForm<RsvpFieldsValues>({
    resolver: zodResolver(rsvpFieldsSchema),
    defaultValues: baseline,
  });
  const [refusal, setRefusal] = useState<DesignRefusalState | null>(null);
  const save = async (values: RsvpFieldsValues) => {
    setRefusal(null);
    const body = rsvpFieldsEdit(design.rsvpFields, baseline, values, locales);
    if (Object.keys(body).length === 0) return page.done(t('questions.nothing'));
    try {
      await updateRsvpFields(browserSession().api, design.slug, body);
      await page.done(t('questions.saved'));
    } catch (error) {
      for (const property of refusedProperties(error)) {
        if ((BUILT_IN_FIELDS as readonly string[]).includes(property)) {
          form.setError(`${property as BuiltInField}.choices`, {
            type: 'server',
            message: 'refused',
          });
        }
      }
      setRefusal({ action: 'rsvpFields', problem: problemFrom(error) });
      if (isStaleRefusal('rsvpFields', error)) page.reload();
    }
  };
  return (
    <AppForm onSubmit={form.handleSubmit(save)} className="max-w-[40rem] gap-4">
      <p className="m-0">{t('questions.attendance')}</p>
      {refusal ? <DesignRefusal refusal={refusal} /> : null}
      {BUILT_IN_FIELDS.map((field) => (
        <BuiltInFieldset key={field} form={form} field={field} locales={locales} />
      ))}
      <SubmitButton isSubmitting={form.formState.isSubmitting} className="w-auto self-start">
        {form.formState.isSubmitting ? t('questions.saving') : t('questions.saveBuiltIn')}
      </SubmitButton>
    </AppForm>
  );
}
