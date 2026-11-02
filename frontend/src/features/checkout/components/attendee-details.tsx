import { useTranslation } from 'react-i18next';

import { ChoiceCard, Chip, Fieldset, TextField } from '@/ui/form';

import { LIMITS } from '../schemas';
import { fieldId, useCheckoutForm, useCheckoutSetting, useFieldError } from './checkout-context';
import { QuestionField } from './question-field';

function Dietary({ index }: { index: number }) {
  const { t } = useTranslation('checkout');
  const { register } = useCheckoutForm();
  const { rules } = useCheckoutSetting();
  const notes = `people.${index}.dietaryNotes` as const;
  const error = useFieldError(notes);
  if (!rules.dietary.isEnabled) return null;
  return (
    <Fieldset legend={t('dietary.legend')} marker={t('question.optional')}>
      {rules.dietary.options ? (
        <div className="flex flex-wrap gap-2">
          {rules.dietary.options.map((option) => (
            <Chip
              key={option.key}
              label={option.label}
              value={option.key}
              {...register(`people.${index}.dietary`)}
            />
          ))}
        </div>
      ) : null}
      <TextField
        id={fieldId(notes)}
        label={t('dietary.notes')}
        maxLength={LIMITS.dietaryNotes}
        error={error}
        {...register(notes)}
      />
    </Fieldset>
  );
}

function Drink({ index }: { index: number }) {
  const { t } = useTranslation('checkout');
  const { register } = useCheckoutForm();
  const { rules } = useCheckoutSetting();
  const path = `people.${index}.drink` as const;
  const error = useFieldError(path);
  if (!rules.drink.isEnabled) return null;
  if (!rules.drink.options) {
    return (
      <TextField
        id={fieldId(path)}
        label={t('drink.legend')}
        optionalText={t('question.optional')}
        maxLength={LIMITS.drink}
        error={error}
        {...register(path)}
      />
    );
  }
  return (
    <Fieldset
      id={fieldId(path)}
      legend={t('drink.legend')}
      marker={t('question.optional')}
      error={error}
    >
      {rules.drink.options.map((option) => (
        <ChoiceCard key={option.key} label={option.label} value={option.key} {...register(path)} />
      ))}
    </Fieldset>
  );
}

/**
 * What the host asks of each person coming: dietary needs, a drink and their own questions, each
 * only when the event asks it (`rsvpFields`). Shared with the hosts' registration of a ticket.
 */
export function AttendeeDetails({ index }: { index: number }) {
  const { rules } = useCheckoutSetting();
  return (
    <div className="grid gap-6">
      <Dietary index={index} />
      <Drink index={index} />
      {rules.questions.map((question) => (
        <QuestionField key={question.id} question={question} index={index} />
      ))}
    </div>
  );
}
