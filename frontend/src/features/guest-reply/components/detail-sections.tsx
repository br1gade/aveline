import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { ChoiceCard, Chip, Fieldset, TextArea, TextField } from '@/ui/form';

import { fieldId } from '../fields';
import { LIMITS } from '../options';
import { useFieldError, useReplyForm } from './form-context';
import type { AnswerOwner } from './question-section';

type DietaryPaths =
  | { list: 'dietary'; notes: 'dietaryNotes' }
  | { list: `members.${number}.dietary`; notes: `members.${number}.dietaryNotes` }
  | { list: `party.${number}.dietary`; notes: `party.${number}.dietaryNotes` };

function dietaryPaths(owner: AnswerOwner): DietaryPaths {
  switch (owner.kind) {
    case 'member':
      return {
        list: `members.${owner.index}.dietary`,
        notes: `members.${owner.index}.dietaryNotes`,
      };
    case 'party':
      return { list: `party.${owner.index}.dietary`, notes: `party.${owner.index}.dietaryNotes` };
    default:
      return { list: 'dietary', notes: 'dietaryNotes' };
  }
}

/**
 * One person's dietary needs: the host's choices as chips, sending their keys, when the
 * invitation gives choices; then a field for anything else. Without choices it is free text
 * (docs/API.md §4, `rsvpFields`).
 */
export function DietaryFields({ owner }: { owner: AnswerOwner }) {
  const { t } = useTranslation('reply');
  const { form, field } = useReplyForm();
  const paths = dietaryPaths(owner);
  const { options } = field('dietary');
  const error = useFieldError(paths.notes);
  return (
    <div className="grid gap-3">
      {options ? (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <Chip
              key={option.key}
              label={option.label}
              value={option.key}
              {...form.register(paths.list)}
            />
          ))}
        </div>
      ) : null}
      <TextField
        id={fieldId(paths.notes)}
        label={t('dietary.notes')}
        maxLength={LIMITS.dietaryNotes}
        error={error}
        {...form.register(paths.notes)}
      />
    </div>
  );
}

/** Asked only when both side labels exist and the invitation asks it. */
export function SideSection({ sides }: { sides: { a: string; b: string } }) {
  const { t } = useTranslation('reply');
  const { form } = useReplyForm();
  const error = useFieldError('attribution');
  const choices = [
    { value: 'SIDE_A', label: sides.a },
    { value: 'SIDE_B', label: sides.b },
    { value: 'SHARED', label: t('side.both') },
  ];
  return (
    <Fieldset
      id={fieldId('attribution')}
      legend={t('side.title')}
      marker={t('question.optional')}
      error={error}
    >
      {choices.map((choice) => (
        <ChoiceCard
          key={choice.value}
          label={choice.label}
          value={choice.value}
          {...form.register('attribution')}
        />
      ))}
    </Fieldset>
  );
}

export function DietarySection() {
  const { t } = useTranslation('reply');
  const error = useFieldError('dietary');
  return (
    <Fieldset
      id={fieldId('dietary')}
      legend={t('dietary.title')}
      marker={t('question.optional')}
      error={error}
    >
      <DietaryFields owner={{ kind: 'respondent' }} />
    </Fieldset>
  );
}

/**
 * One drink per reply. The host's choices are radio cards, since single choice never looks like
 * chips (PD-32); without choices it is a short text.
 */
export function DrinkSection() {
  const { t } = useTranslation('reply');
  const { form, field } = useReplyForm();
  const { options } = field('drinkPreference');
  const error = useFieldError('drinkPreference');
  if (!options) {
    return (
      <TextField
        id={fieldId('drinkPreference')}
        label={t('drink.title')}
        optionalText={t('question.optional')}
        maxLength={LIMITS.drink}
        error={error}
        {...form.register('drinkPreference')}
      />
    );
  }
  return (
    <Fieldset
      id={fieldId('drinkPreference')}
      legend={t('drink.title')}
      marker={t('question.optional')}
      error={error}
    >
      {options.map((option) => (
        <ChoiceCard
          key={option.key}
          label={option.label}
          value={option.key}
          {...form.register('drinkPreference')}
        />
      ))}
    </Fieldset>
  );
}

function useCounter(name: 'songRequest' | 'message', limit: number): string {
  const { t } = useTranslation('reply');
  const { form } = useReplyForm();
  const value = useWatch({ control: form.control, name });
  return t('counter', { count: value.length, limit });
}

export function SongSection() {
  const { t } = useTranslation('reply');
  const { form } = useReplyForm();
  const counter = useCounter('songRequest', LIMITS.song);
  const error = useFieldError('songRequest');
  return (
    <TextField
      id={fieldId('songRequest')}
      label={t('song.title')}
      optionalText={t('question.optional')}
      help={t('song.help')}
      counter={counter}
      maxLength={LIMITS.song}
      error={error}
      {...form.register('songRequest')}
    />
  );
}

export function MessageSection() {
  const { t } = useTranslation('reply');
  const { form } = useReplyForm();
  const counter = useCounter('message', LIMITS.message);
  const error = useFieldError('message');
  return (
    <TextArea
      id={fieldId('message')}
      label={t('message.title')}
      optionalText={t('question.optional')}
      counter={counter}
      maxLength={LIMITS.message}
      error={error}
      {...form.register('message')}
    />
  );
}
