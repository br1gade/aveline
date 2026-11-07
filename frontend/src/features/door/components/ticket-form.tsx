import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { AppForm, SubmitButton, TextInputField } from '@/ui/app-form';

import { CODE_RUNNING } from '../arrival';
import { readCode } from '../ticket-code';
import { TicketScanner } from './ticket-scanner';
import type { Door } from './use-door';

type Mistake = 'empty' | 'notLatin' | null;

interface TicketFormProps {
  door: Door;
  typed: string;
  setTyped: (typed: string) => void;
}

/**
 * Admitting a ticket by its typed code (design PD-91), the way in when the camera fails. The code stays in this
 * field alone: not in the address, never stored, and gone once the server has answered about it. A
 * press with no answer, a typo and "too many tries" keep it, to press again or fix. Nothing helps
 * the browser remember it, and a spell-checker never sees it.
 */
function TicketForm({ door, typed, setTyped }: TicketFormProps) {
  const { t } = useTranslation('door');
  const [mistake, setMistake] = useState<Mistake>(null);
  const isRunning = door.state.running === CODE_RUNNING;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const entry = readCode(typed);
    if (entry.kind !== 'ready') {
      setMistake(entry.kind);
      return;
    }
    setMistake(null);
    if (await door.actions.admit(entry.code)) setTyped('');
  };

  return (
    <AppForm onSubmit={(event) => void submit(event)}>
      <TextInputField
        label={t('code.label')}
        help={t('code.help')}
        error={mistake ? t(`code.${mistake}`) : undefined}
        name="door-ticket"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          setMistake(null);
          door.actions.codeEdited();
        }}
      />
      <SubmitButton
        isSubmitting={door.state.running !== null}
        className="h-auto min-h-12 py-2 whitespace-normal pointer-coarse:h-auto pointer-coarse:min-h-12"
      >
        {t(isRunning ? 'code.admitting' : 'code.admit')}
      </SubmitButton>
    </AppForm>
  );
}

/**
 * The camera above the typed field. A scan the field would have kept, with no answer, not recognised or
 * too many tries, comes to rest in the field, where there is something to press or fix; it never re-sends
 * by itself, as a code that can be read isn't always one that should go twice. A scan that is done with
 * takes only its own code away.
 */
export function TicketByCode({ door }: { door: Door }) {
  const [typed, setTyped] = useState('');
  const onAnswer = (code: string, isDone: boolean) => {
    if (!isDone) setTyped(code);
    else setTyped((current) => (current === code ? '' : current));
  };
  return (
    <>
      <TicketScanner door={door} onAnswer={onAnswer} />
      <TicketForm door={door} typed={typed} setTyped={setTyped} />
    </>
  );
}
