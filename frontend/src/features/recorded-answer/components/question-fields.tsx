import { useId } from 'react';
import { Controller, useController } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { ErrorLine, SelectField, TextInputField } from '@/ui/app-form';
import { Checkbox } from '@/ui/kit/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/ui/kit/field';
import { Label } from '@/ui/kit/label';
import { NativeSelectOption } from '@/ui/kit/native-select';
import { RadioGroup, RadioGroupItem } from '@/ui/kit/radio-group';
import { Textarea } from '@/ui/kit/textarea';

import { isAnswerable, type AskedField, type AskedQuestion, type Asking } from '../asking';
import type { AnswerForm } from './attendance-fields';
import { useErrorText } from './attendance-fields';

interface Choice {
  value: string;
  label: string;
  /** The choice's language, when it isn't the page's. */
  lang?: string | undefined;
}

/** Ticks among several choices, kept as a list of values. */
function CheckList({
  name,
  legend,
  legendLang,
  help,
  error,
  choices,
  form,
}: {
  name: `answers.${string}` | 'dietary';
  legend: string;
  legendLang?: string | undefined;
  help?: string | undefined;
  error?: string | undefined;
  choices: readonly Choice[];
  form: AnswerForm;
}) {
  const id = useId();
  const { field } = useController({ control: form.control, name });
  const chosen = Array.isArray(field.value) ? field.value : [];
  const toggle = (value: string, isTicked: boolean) =>
    field.onChange(isTicked ? [...chosen, value] : chosen.filter((one) => one !== value));
  return (
    <fieldset
      className="m-0 flex flex-col gap-1 border-0 p-0"
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend lang={legendLang} className="mb-1 p-0 text-sm font-medium">
        {legend}
      </legend>
      {help ? <p className="text-muted-foreground m-0 text-sm">{help}</p> : null}
      {choices.map((choice) => (
        <div key={choice.value} className="flex min-h-11 items-center gap-3">
          <Checkbox
            id={`${id}-${choice.value}`}
            checked={chosen.includes(choice.value)}
            onCheckedChange={(checked) => toggle(choice.value, checked === true)}
          />
          <Label htmlFor={`${id}-${choice.value}`} lang={choice.lang} className="font-normal">
            {choice.label}
          </Label>
        </div>
      ))}
      {error ? <ErrorLine id={`${id}-error`}>{error}</ErrorLine> : null}
    </fieldset>
  );
}

/** A long answer in a text area, labelled and tied to its error. */
function LongText({
  name,
  label,
  labelLang,
  help,
  form,
}: {
  name: `answers.${string}` | 'message';
  label: string;
  labelLang?: string | undefined;
  help?: string | undefined;
  form: AnswerForm;
}) {
  const id = useId();
  const error = useErrorText()(form.getFieldState(name, form.formState).error);
  return (
    <Field className="gap-2">
      <FieldLabel htmlFor={id} lang={labelLang}>
        {label}
      </FieldLabel>
      <Textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [help ? `${id}-help` : '', error ? `${id}-error` : ''].join(' ').trim() || undefined
        }
        {...form.register(name)}
      />
      {help ? <FieldDescription id={`${id}-help`}>{help}</FieldDescription> : null}
      {error ? (
        <p id={`${id}-error`} className="text-destructive m-0 text-sm">
          {error}
        </p>
      ) : null}
    </Field>
  );
}

function YesNo({
  error,
  question,
  form,
  help,
}: {
  question: AskedQuestion;
  form: AnswerForm;
  help?: string | undefined;
  error?: string | undefined;
}) {
  const { t } = useTranslation('recorded-answer');
  const id = useId();
  return (
    <fieldset
      className="m-0 flex flex-col gap-1 border-0 p-0"
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend
        id={`${id}-legend`}
        lang={question.prompt.language}
        className="mb-1 p-0 text-sm font-medium"
      >
        {question.prompt.text}
      </legend>
      {help ? <p className="text-muted-foreground m-0 text-sm">{help}</p> : null}
      <Controller
        control={form.control}
        name={`answers.${question.id}`}
        render={({ field }) => (
          <RadioGroup
            aria-labelledby={`${id}-legend`}
            value={typeof field.value === 'string' ? field.value : ''}
            onValueChange={field.onChange}
            className="gap-1"
          >
            {(['yes', 'no'] as const).map((value) => (
              <div key={value} className="flex min-h-11 items-center gap-3">
                <RadioGroupItem value={value} id={`${id}-${value}`} />
                <Label htmlFor={`${id}-${value}`} className="font-normal">
                  {t(`question.${value}`)}
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}
      />
      {error ? <ErrorLine id={`${id}-error`}>{error}</ErrorLine> : null}
    </fieldset>
  );
}

/** One of the host's own questions, by its kind; a signature is only explained. */
function QuestionField({ question, form }: { question: AskedQuestion; form: AnswerForm }) {
  const { t } = useTranslation('recorded-answer');
  const errorText = useErrorText();
  const help = question.isRequired ? t('question.requiredHelp') : undefined;
  const name = `answers.${question.id}` as const;
  const error = errorText(form.getFieldState(name, form.formState).error);
  const prompt = { label: question.prompt.text, labelLang: question.prompt.language };
  const choices = question.options.map((label, index) => ({
    value: String(index),
    label,
    lang: question.optionsLanguage,
  }));
  if (!isAnswerable(question)) {
    return (
      <div className="flex flex-col gap-1">
        <p lang={question.prompt.language} className="m-0 text-sm font-medium">
          {question.prompt.text}
        </p>
        <p className="text-muted-foreground m-0 text-sm">{t('question.signature')}</p>
      </div>
    );
  }
  if (question.type === 'BOOLEAN')
    return <YesNo question={question} form={form} help={help} error={error} />;
  if (question.type === 'MULTI_CHOICE')
    return (
      <CheckList
        name={name}
        legend={question.prompt.text}
        legendLang={question.prompt.language}
        help={help}
        error={error}
        choices={choices}
        form={form}
      />
    );
  if (question.type === 'LONG_TEXT')
    return <LongText name={name} {...prompt} help={help} form={form} />;
  if (question.type === 'SINGLE_CHOICE') {
    return (
      <SelectField {...prompt} help={help} error={error} {...form.register(name)}>
        <NativeSelectOption value="">{t('question.notAnswered')}</NativeSelectOption>
        {choices.map((choice) => (
          <NativeSelectOption key={choice.value} value={choice.value} lang={choice.lang}>
            {choice.label}
          </NativeSelectOption>
        ))}
      </SelectField>
    );
  }
  return (
    <TextInputField
      {...prompt}
      help={help}
      autoComplete="off"
      error={error}
      {...form.register(name)}
    />
  );
}

/** A built-in question switched on: choices when the invitation gives them, else free text. */
function BuiltInField({ asked, form }: { asked: AskedField; form: AnswerForm }) {
  const { t } = useTranslation('recorded-answer');
  const errorText = useErrorText();
  const { errors } = form.formState;
  const { field, options } = asked;
  const choices = (options ?? []).map((option) => ({
    value: option.key,
    label: option.label.text,
    lang: option.label.language,
  }));
  if (field === 'dietary') {
    return (
      <>
        {options ? (
          <CheckList name="dietary" legend={t('fields.dietary')} choices={choices} form={form} />
        ) : (
          <TextInputField
            label={t('fields.dietary')}
            autoComplete="off"
            error={errorText(errors.dietaryText)}
            {...form.register('dietaryText')}
          />
        )}
        <TextInputField
          label={t('fields.dietaryNotes')}
          autoComplete="off"
          error={errorText(errors.dietaryNotes)}
          {...form.register('dietaryNotes')}
        />
      </>
    );
  }
  if (options) {
    return (
      <SelectField label={t(`fields.${field}`)} {...form.register(field)}>
        <NativeSelectOption value="">{t('question.notAnswered')}</NativeSelectOption>
        {choices.map((choice) => (
          <NativeSelectOption key={choice.value} value={choice.value} lang={choice.lang}>
            {choice.label}
          </NativeSelectOption>
        ))}
      </SelectField>
    );
  }
  if (field === 'message')
    return <LongText name="message" label={t('fields.message')} form={form} />;
  return (
    <TextInputField
      label={t(`fields.${field}`)}
      autoComplete="off"
      error={errorText(errors[field])}
      {...form.register(field)}
    />
  );
}

/** The built-in questions switched on, then the host's own, in the host's order. */
export function QuestionFields({ asking, form }: { asking: Asking; form: AnswerForm }) {
  return (
    <>
      {asking.fields.map((asked) => (
        <BuiltInField key={asked.field} asked={asked} form={form} />
      ))}
      {asking.questions.map((question) => (
        <QuestionField key={question.id} question={question} form={form} />
      ))}
    </>
  );
}
