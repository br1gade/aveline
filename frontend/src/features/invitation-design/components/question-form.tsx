import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useMemo, useState } from 'react';
import {
  useController,
  useFieldArray,
  useForm,
  useWatch,
  type UseFormReturn,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useRevalidator } from 'react-router';

import { problemFrom } from '@/api/problems';
import { browserSession } from '@/api/session';
import type { QuestionType } from '@/features/invitation-renderer';
import { AppForm, ErrorLine, SelectField, SubmitButton, TextInputField } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { Checkbox } from '@/ui/kit/checkbox';
import { FieldDescription, FieldLegend, FieldSet } from '@/ui/kit/field';
import { Label } from '@/ui/kit/label';
import { NativeSelectOption } from '@/ui/kit/native-select';

import { createQuestion, updateQuestion } from '../api';
import {
  newQuestionValues,
  questionFormValues,
  takesChoices,
  type QuestionValues,
} from '../form-model';
import { designQuestionsPath } from '../paths';
import { choiceLists, questionCreate, questionEdit } from '../payload';
import { isStaleRefusal, type DesignAction } from '../refusals';
import { questionSchema } from '../schemas';
import { refusedProperties } from '../server-errors';
import type { Design, Question } from '../types';
import { useFieldText } from '../use-field-text';
import { useLanguageLabel } from './built-in-questions';
import { DesignRefusal, type DesignRefusalState } from './design-parts';

type QuestionForm = UseFormReturn<QuestionValues>;

const QUESTION_TYPES: readonly QuestionType[] = [
  'TEXT',
  'LONG_TEXT',
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
  'BOOLEAN',
  'SIGNATURE',
];

interface PartProps {
  form: QuestionForm;
  locales: readonly string[];
  /** Answered: its type cannot change, and its choices can only be reworded or added to. */
  question: Question | null;
}

function useTypeHelp(form: QuestionForm, isLocked: boolean): string | undefined {
  const { t } = useTranslation('design');
  const type = useWatch({ control: form.control, name: 'type' });
  if (isLocked) return t('question.typeLocked');
  return type === 'SIGNATURE' ? t('question.signatureHelp') : undefined;
}

function TypeAndRequired({ form, question }: Omit<PartProps, 'locales'>) {
  const { t } = useTranslation('design');
  const id = useId();
  const required = useController({ control: form.control, name: 'required' });
  const isLocked = (question?.answerCount ?? 0) > 0;
  const help = useTypeHelp(form, isLocked);
  return (
    <>
      <SelectField
        label={t('question.type')}
        help={help}
        disabled={isLocked}
        {...form.register('type')}
      >
        {QUESTION_TYPES.map((value) => (
          <NativeSelectOption key={value} value={value}>
            {t(`questions.types.${value}`)}
          </NativeSelectOption>
        ))}
      </SelectField>
      <div className="flex min-h-11 items-center gap-3">
        <Checkbox
          id={id}
          checked={required.field.value}
          onCheckedChange={(checked) => required.field.onChange(checked === true)}
        />
        <Label htmlFor={id} className="font-normal">
          {t('question.required')}
        </Label>
      </div>
    </>
  );
}

function Prompt({ form, locales }: Omit<PartProps, 'question'>) {
  const { t } = useTranslation('design');
  const languageLabel = useLanguageLabel();
  const fieldText = useFieldText();
  const error = fieldText(form.formState.errors.prompt);
  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label">{t('question.prompt')}</FieldLegend>
      <FieldDescription>{t('question.promptHelp')}</FieldDescription>
      {locales.map((locale) => (
        <TextInputField
          key={locale}
          lang={locale}
          label={languageLabel(locale)}
          autoComplete="off"
          {...form.register(`prompt.${locale}`)}
        />
      ))}
      {error ? <ErrorLine id="question-prompt-error">{error}</ErrorLine> : null}
    </FieldSet>
  );
}

interface ChoiceRowProps {
  form: QuestionForm;
  locales: readonly string[];
  position: number;
  /** `null` for a choice guests have answered with, which stays. */
  onRemove: (() => void) | null;
}

function ChoiceRow({ form, locales, position, onRemove }: ChoiceRowProps) {
  const { t } = useTranslation('design');
  const languageLabel = useLanguageLabel();
  return (
    <li className="border-border flex flex-col gap-3 border-l-2 pl-4">
      {locales.map((locale) => (
        <TextInputField
          key={locale}
          lang={locale}
          label={t('questions.choiceIn', { number: position + 1, language: languageLabel(locale) })}
          autoComplete="off"
          {...form.register(`choices.${position}.${locale}`)}
        />
      ))}
      {onRemove ? (
        <Button type="button" variant="ghost" className="self-start" onClick={onRemove}>
          {t('questions.removeChoice', { number: position + 1 })}
        </Button>
      ) : null}
    </li>
  );
}

/** Which languages are half filled, worked out from the same rule as the schema's. */
function ChoicesError({ form, locales }: Omit<PartProps, 'question'>) {
  const { t } = useTranslation('design');
  const languageLabel = useLanguageLabel();
  const fieldText = useFieldText();
  const choices = useWatch({ control: form.control, name: 'choices' });
  const error = form.formState.errors.choices;
  if (!error) return null;
  const message = error.root ?? error;
  const { halfFilled } = choiceLists(choices, locales);
  return (
    <ErrorLine id="question-choices-error">
      {message.message === 'halfFilled'
        ? t('errors.halfFilledIn', { languages: halfFilled.map(languageLabel).join(', ') })
        : fieldText(message)}
    </ErrorLine>
  );
}

/** Rows of choices, one label per language each, so every language lists as many (PD-61). */
function Choices({ form, locales, question }: PartProps) {
  const { t } = useTranslation('design');
  const choices = useFieldArray({ control: form.control, name: 'choices' });
  const isAnswered = (question?.answerCount ?? 0) > 0;
  const kept = question && isAnswered ? questionFormValues(question, locales).choices.length : 0;
  const empty = () => Object.fromEntries(locales.map((locale) => [locale, '']));
  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label">{t('question.choices')}</FieldLegend>
      <FieldDescription>
        {t(isAnswered ? 'question.answeredChoices' : 'question.choicesHelp')}
      </FieldDescription>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {choices.fields.map((choice, position) => (
          <ChoiceRow
            key={choice.id}
            form={form}
            locales={locales}
            position={position}
            onRemove={position >= kept ? () => choices.remove(position) : null}
          />
        ))}
      </ol>
      <ChoicesError form={form} locales={locales} />
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => choices.append(empty())}
      >
        {t('questions.addChoice')}
      </Button>
    </FieldSet>
  );
}

const FIELD_OF: Readonly<Record<string, 'type' | 'prompt' | 'choices'>> = {
  type: 'type',
  prompt: 'prompt',
  options: 'choices',
};

interface QuestionFormProps {
  design: Design;
  /** The question to correct; none to add one. */
  question: Question | null;
}

function useSaveQuestion(
  { design, question }: QuestionFormProps,
  form: QuestionForm,
  baseline: QuestionValues,
) {
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const [refusal, setRefusal] = useState<DesignRefusalState | null>(null);
  const action: DesignAction = question ? 'editQuestion' : 'createQuestion';
  const { locales } = design.event;
  const save = async (values: QuestionValues) => {
    setRefusal(null);
    const { api } = browserSession();
    try {
      if (!question) await createQuestion(api, design.slug, questionCreate(values, locales));
      else {
        const body = questionEdit(question, baseline, values, locales);
        if (Object.keys(body).length > 0) await updateQuestion(api, design.slug, question.id, body);
      }
      await navigate(designQuestionsPath(design.event.id));
    } catch (error) {
      for (const property of refusedProperties(error)) {
        const field = FIELD_OF[property];
        if (field) form.setError(field, { type: 'server', message: 'refused' });
      }
      setRefusal({ action, problem: problemFrom(error) });
      // A question removed meanwhile: the page reloads and says so.
      if (isStaleRefusal(action, error)) void revalidate();
    }
  };
  return { refusal, save };
}

/**
 * Adding a question of the host's own, or correcting one (design PD-61): its kind, whether it is
 * required, its wording in each of the event's languages and, for a choice, its choices.
 */
export function QuestionFormView({ design, question }: QuestionFormProps) {
  const { t } = useTranslation('design');
  const { locales } = design.event;
  const schema = useMemo(() => questionSchema(locales), [locales]);
  const [baseline] = useState(() =>
    question ? questionFormValues(question, locales) : newQuestionValues(locales),
  );
  const form = useForm<QuestionValues>({ resolver: zodResolver(schema), defaultValues: baseline });
  const { refusal, save } = useSaveQuestion({ design, question }, form, baseline);
  const type = useWatch({ control: form.control, name: 'type' });
  const { isSubmitting } = form.formState;
  return (
    <AppForm onSubmit={form.handleSubmit(save)} className="max-w-[30rem] gap-5">
      {refusal ? <DesignRefusal refusal={refusal} /> : null}
      <TypeAndRequired form={form} question={question} />
      <Prompt form={form} locales={locales} />
      {takesChoices(type) ? <Choices form={form} locales={locales} question={question} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton isSubmitting={isSubmitting} className="w-auto">
          {isSubmitting ? t('question.saving') : t(question ? 'question.save' : 'question.add')}
        </SubmitButton>
        <Button asChild variant="ghost">
          <Link to={designQuestionsPath(design.event.id)}>{t('question.cancel')}</Link>
        </Button>
      </div>
    </AppForm>
  );
}
