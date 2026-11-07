import { useTranslation } from 'react-i18next';

import type { CheckoutQuestion } from '@/features/public-event';
import { ChoiceCard, Chip, Fieldset, TextArea, TextField } from '@/ui/form';

import { LIMITS } from '../schemas';
import { fieldId, useCheckoutForm, useFieldError } from './checkout-context';

type AnswerPath = `people.${number}.answers.${string}`;

/** Choices send their position, never their words (C-17), as the reply form does. */
function Choices({ question, path }: { question: CheckoutQuestion; path: AnswerPath }) {
  const { t } = useTranslation('checkout');
  const { register } = useCheckoutForm();
  const field = register(path);
  if (question.type === 'MULTI_CHOICE') {
    return (
      <div className="flex flex-wrap gap-2">
        {question.options.map((option, position) => (
          <Chip key={position} label={option} value={String(position)} {...field} />
        ))}
      </div>
    );
  }
  const options =
    question.type === 'BOOLEAN'
      ? (['yes', 'no'] as const).map((answer) => ({
          value: answer,
          label: t(`question.${answer}`),
        }))
      : question.options.map((option, position) => ({ value: String(position), label: option }));
  return options.map((option) => (
    <ChoiceCard key={option.value} label={option.label} value={option.value} {...field} />
  ));
}

/** One of the host's questions, for one person: text as a field, the rest as a fieldset. */
export function QuestionField({ question, index }: { question: CheckoutQuestion; index: number }) {
  const { t } = useTranslation('checkout');
  const { register } = useCheckoutForm();
  const path: AnswerPath = `people.${index}.answers.${question.id}`;
  const error = useFieldError(path);
  const marker = question.required ? t('question.required') : t('question.optional');
  const prompt = question.prompt ?? t('question.untitled');
  if (question.type === 'TEXT' || question.type === 'LONG_TEXT') {
    const Field = question.type === 'TEXT' ? TextField : TextArea;
    return (
      <Field
        id={fieldId(path)}
        label={prompt}
        optionalText={marker}
        error={error}
        maxLength={question.type === 'TEXT' ? LIMITS.text : LIMITS.longText}
        {...register(path)}
      />
    );
  }
  return (
    <Fieldset id={fieldId(path)} legend={prompt} marker={marker} error={error}>
      <Choices question={question} path={path} />
    </Fieldset>
  );
}
