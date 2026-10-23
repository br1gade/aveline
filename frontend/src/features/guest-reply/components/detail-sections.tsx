import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { ChoiceCard, Chip, Fieldset, TextArea, TextField } from '@/ui/form';

import { fieldId } from '../fields';
import { DIETARY_OPTIONS, DRINK_OPTIONS, isDietaryOption, isDrinkOption, LIMITS } from '../options';
import { useFieldError, useReplyForm } from './form-context';

type DietaryPath = 'dietary' | `members.${number}.dietary`;

/**
 * The sample options as chips (PD-15), sending the English key. A value saved some other way is
 * kept as a chip of its own, so an edit never drops it unseen.
 */
export function DietaryChips({ name, saved }: { name: DietaryPath; saved: readonly string[] }) {
  const { t } = useTranslation('reply');
  const { form } = useReplyForm();
  const extras = saved.filter((value) => !isDietaryOption(value));
  return (
    <div className="flex flex-wrap gap-2">
      {DIETARY_OPTIONS.map((option) => (
        <Chip
          key={option}
          label={t(`dietary.options.${option}`)}
          value={option}
          {...form.register(name)}
        />
      ))}
      {extras.map((value) => (
        <Chip key={value} label={value} value={value} {...form.register(name)} />
      ))}
    </div>
  );
}

/** Asked only when both side labels exist (spec §6.1c, PD-16). */
export function SideSection({ sides }: { sides: { a: string; b: string } }) {
  const { t } = useTranslation('reply');
  const { form } = useReplyForm();
  const choices = [
    { value: 'SIDE_A', label: sides.a },
    { value: 'SIDE_B', label: sides.b },
    { value: 'SHARED', label: t('side.both') },
  ];
  return (
    <Fieldset id={fieldId('attribution')} legend={t('side.title')} marker={t('question.optional')}>
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
  const { form, record } = useReplyForm();
  const error = useFieldError('dietaryNotes', form.formState.errors.dietaryNotes?.message);
  return (
    <Fieldset id={fieldId('dietary')} legend={t('dietary.title')} marker={t('question.optional')}>
      <DietaryChips name="dietary" saved={record.rsvp.dietary ?? []} />
      <TextField
        id={fieldId('dietaryNotes')}
        label={t('dietary.notes')}
        maxLength={LIMITS.dietaryNotes}
        error={error}
        {...form.register('dietaryNotes')}
      />
    </Fieldset>
  );
}

/** One drink per reply, as radio cards: single choice never looks like chips (PD-32). */
export function DrinkSection() {
  const { t } = useTranslation('reply');
  const { form, record } = useReplyForm();
  const saved = record.rsvp.drinkPreference ?? '';
  const extra = saved && !isDrinkOption(saved) ? saved : undefined;
  return (
    <Fieldset
      id={fieldId('drinkPreference')}
      legend={t('drink.title')}
      marker={t('question.optional')}
    >
      {DRINK_OPTIONS.map((option) => (
        <ChoiceCard
          key={option}
          label={t(`drink.options.${option}`)}
          value={option}
          {...form.register('drinkPreference')}
        />
      ))}
      {extra ? (
        <ChoiceCard label={extra} value={extra} {...form.register('drinkPreference')} />
      ) : null}
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
  const error = useFieldError('songRequest', form.formState.errors.songRequest?.message);
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
  const error = useFieldError('message', form.formState.errors.message?.message);
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
