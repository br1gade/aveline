import { useTranslation } from 'react-i18next';

import type { RsvpQuestion } from '@/features/invitation-renderer';
import { ChoiceCard, Chip, Fieldset, TextArea, TextField } from '@/ui/form';

import { fieldId } from '../fields';
import { answerableQuestions } from '../form-model';
import { LIMITS } from '../options';
import { useFieldError, useReplyForm } from './form-context';

/** The control for one question type (spec §6.1g). Choices send their position, never their text. */
function QuestionControl({ question }: { question: RsvpQuestion }) {
  const { t } = useTranslation('reply');
  const { form } = useReplyForm();
  const field = form.register(`answers.${question.id}`);
  switch (question.type) {
    case 'SINGLE_CHOICE':
      return question.options.map((option, position) => (
        <ChoiceCard key={position} label={option} value={String(position)} {...field} />
      ));
    case 'MULTI_CHOICE':
      return (
        <div className="flex flex-wrap gap-2">
          {question.options.map((option, position) => (
            <Chip key={position} label={option} value={String(position)} {...field} />
          ))}
        </div>
      );
    case 'BOOLEAN':
      return (['yes', 'no'] as const).map((answer) => (
        <ChoiceCard key={answer} label={t(`question.${answer}`)} value={answer} {...field} />
      ));
    default:
      return null;
  }
}

/** Text questions are a field labelled by the prompt; the rest are a fieldset with a legend. */
function Question({ question }: { question: RsvpQuestion }) {
  const { t } = useTranslation('reply');
  const { form } = useReplyForm();
  const path = `answers.${question.id}`;
  const error = useFieldError(path, form.formState.errors.answers?.[question.id]?.message);
  const marker = question.required ? t('question.required') : t('question.optional');
  const prompt = question.prompt ?? '';
  if (question.type === 'TEXT' || question.type === 'LONG_TEXT') {
    const Field = question.type === 'TEXT' ? TextField : TextArea;
    return (
      <Field
        id={fieldId(path)}
        label={prompt}
        optionalText={marker}
        error={error}
        maxLength={question.type === 'TEXT' ? LIMITS.text : LIMITS.longText}
        {...form.register(`answers.${question.id}`)}
      />
    );
  }
  return (
    <Fieldset id={fieldId(path)} legend={prompt} marker={marker} error={error}>
      <QuestionControl question={question} />
    </Fieldset>
  );
}

/** The host's own questions, in their order. SIGNATURE is never shown (PD-23). */
export function QuestionSection() {
  const { invitation } = useReplyForm();
  return answerableQuestions(invitation.rsvpQuestions).map((question) => (
    <Question key={question.id} question={question} />
  ));
}
