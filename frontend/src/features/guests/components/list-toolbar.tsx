import { useTranslation } from 'react-i18next';

import { SelectField, TextInputField } from '@/ui/app-form';
import { NativeSelectOption } from '@/ui/kit/native-select';

import type { GuestFilter } from '../filter';
import { ANSWERS, type Answer } from '../types';

interface ListToolbarProps {
  filter: GuestFilter;
  onQuery: (query: string) => void;
  onAnswer: (answer: Answer | null) => void;
}

function answerOf(value: string): Answer | null {
  return ANSWERS.find((answer) => answer === value) ?? null;
}

/**
 * The search and the answer filter (design PD-44), kept in view while the list scrolls. Not a form:
 * nothing here is submitted, so Enter sends nothing anywhere.
 */
export function ListToolbar({ filter, onQuery, onAnswer }: ListToolbarProps) {
  const { t } = useTranslation('guests');
  return (
    <div
      role="search"
      aria-label={t('toolbar.label')}
      className="bg-background border-border sticky top-0 z-10 grid gap-3 border-b py-3 sm:grid-cols-[1fr_14rem]"
    >
      <TextInputField
        label={t('toolbar.search')}
        type="search"
        autoComplete="off"
        value={filter.query}
        onChange={(event) => onQuery(event.target.value)}
      />
      <SelectField
        label={t('toolbar.answer')}
        value={filter.answer ?? ''}
        onChange={(event) => onAnswer(answerOf(event.target.value))}
      >
        <NativeSelectOption value="">{t('toolbar.anyAnswer')}</NativeSelectOption>
        {ANSWERS.map((answer) => (
          <NativeSelectOption key={answer} value={answer}>
            {t(`answer.${answer}`)}
          </NativeSelectOption>
        ))}
      </SelectField>
    </div>
  );
}
