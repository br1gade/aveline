import { useTranslation } from 'react-i18next';

import type { RsvpQuestion } from '@/features/invitation-renderer';
import { ChoiceCard, Chip, Fieldset, TextArea, TextField } from '@/ui/form';

import { fieldId } from '../fields';
import { answerableQuestions } from '../form-model';
import { LIMITS } from '../options';
import { useFieldError, useReplyForm } from './form-context';

/** Whose answers these are: the respondent's, a household member's, or a guest added here. */
export type AnswerOwner =
  { kind: 'respondent' } | { kind: 'member'; index: number } | { kind: 'party'; index: number };

type AnswerPath =
  `answers.${string}` | `members.${number}.answers.${string}` | `party.${number}.answers.${string}`;

function answerPath(owner: AnswerOwner, questionId: string): AnswerPath {
  switch (owner.kind) {
    case 'member':
      return `members.${owner.index}.answers.${questionId}`;
    case 'party':
      return `party.${owner.index}.answers.${questionId}`;
    default:
      return `answers.${questionId}`;
  }
}

/** The control for one question type (spec §6.1g). Choices send their position, never their text. */
function QuestionControl({ question, path }: { question: RsvpQuestion; path: AnswerPath }) {
  const { t } = useTranslation('reply');
  const { form } = useReplyForm();
  const field = form.register(path);
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
function Question({ question, owner }: { question: RsvpQuestion; owner: AnswerOwner }) {
  const { t } = useTranslation('reply');
  const { form } = useReplyForm();
  const path = answerPath(owner, question.id);
  const error = useFieldError(path);
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
        {...form.register(path)}
      />
    );
  }
  return (
    <Fieldset id={fieldId(path)} legend={prompt} marker={marker} error={error}>
      <QuestionControl question={question} path={path} />
    </Fieldset>
  );
}

/**
 * The host's own questions, in their order, for one person: each attending person answers for
 * themselves, so each chooses their own meal. SIGNATURE is never shown (PD-23).
 */
export function QuestionSection({ owner = { kind: 'respondent' } }: { owner?: AnswerOwner }) {
  const { invitation } = useReplyForm();
  return answerableQuestions(invitation.rsvpQuestions).map((question) => (
    <Question key={question.id} question={question} owner={owner} />
  ));
}
