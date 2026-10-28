import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/ui';
import { ChoiceCard, Chip, Fieldset, TextField } from '@/ui/form';

import { fieldId } from '../fields';
import type { ReplyFormValues } from '../form-model';
import {
  attendingPeople,
  SIGNER_NAME_LIMIT,
  signeesFor,
  type Signee,
  type Statement,
} from '../signatures';
import { useFieldError, useReplyForm } from './form-context';
import { SignaturePad } from './signature-pad';

function InlineError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p className="text-error m-0 flex items-start gap-2 text-sm leading-5">
      <Icon name="circle-alert" size={18} className="mt-px" />
      {message}
    </p>
  );
}

function names(people: readonly Signee[]): string {
  return people.map((person) => person.name).join(', ');
}

/** The form's values as they stand, for working out who is coming and must agree. */
function useCurrentValues(): ReplyFormValues {
  const { form } = useReplyForm();
  const [status, venues, members, party, signatures] = useWatch({
    control: form.control,
    name: ['status', 'venues', 'members', 'party', 'signatures'],
  });
  return { ...form.getValues(), status, venues, members, party, signatures };
}

/** How the respondent signs: their name always, and a drawing when they draw (PD-52). */
function SigningDetails({ statement, others }: { statement: Statement; others: Signee[] }) {
  const { t } = useTranslation('reply');
  const { form } = useReplyForm();
  const path = `signatures.${statement.questionId}` as const;
  const method = useWatch({ control: form.control, name: `${path}.method` });
  const onBehalfError = useFieldError(`${path}.isOnBehalf`);
  const nameError = useFieldError(`${path}.signerName`);
  return (
    <>
      {others.length > 0 ? (
        <div className="grid gap-2">
          <Chip
            id={fieldId(`${path}.isOnBehalf`)}
            label={t('signature.onBehalf', { names: names(others) })}
            {...form.register(`${path}.isOnBehalf`)}
          />
          <InlineError message={onBehalfError} />
        </div>
      ) : null}
      <Fieldset legend={t('signature.method')}>
        {(['TYPED', 'DRAWN'] as const).map((value) => (
          <ChoiceCard
            key={value}
            label={t(`signature.${value}`)}
            value={value}
            {...form.register(`${path}.method`)}
          />
        ))}
      </Fieldset>
      <TextField
        id={fieldId(`${path}.signerName`)}
        label={t('signature.signerName')}
        help={method === 'DRAWN' ? t('signature.drawnHelp') : t('signature.typedHelp')}
        autoComplete="name"
        maxLength={SIGNER_NAME_LIMIT}
        error={nameError}
        {...form.register(`${path}.signerName`)}
      />
      {method === 'DRAWN' ? <SignaturePad questionId={statement.questionId} /> : null}
    </>
  );
}

interface StatementProps {
  statement: Statement;
  signees: Signee[];
  already: Signee[];
}

/**
 * One statement: its wording, in the language it is recorded in, whom this reply agrees for and
 * who already has, the agreement itself, and how the respondent signs.
 */
function StatementSection({ statement, signees, already }: StatementProps) {
  const { t } = useTranslation('reply');
  const { form, signatures } = useReplyForm();
  const path = `signatures.${statement.questionId}` as const;
  const isAcknowledged = useWatch({ control: form.control, name: `${path}.isAcknowledged` });
  const agreeError = useFieldError(`${path}.isAcknowledged`);
  const signer = signatures?.signer.guestId;
  return (
    <Fieldset
      id={fieldId(path)}
      legend={t('signature.legend')}
      marker={statement.required ? t('question.required') : t('question.optional')}
      error={agreeError}
    >
      <blockquote
        lang={statement.locale}
        className="border-hairline text-ink m-0 border-l-2 pl-4 whitespace-pre-line"
      >
        {statement.prompt}
      </blockquote>
      <p className="text-ink-muted m-0 text-sm leading-5">
        {t('signature.for', { names: names(signees) })}
      </p>
      {already.length > 0 ? (
        <p className="text-ink-muted m-0 text-sm leading-5">
          {t('signature.already', { names: names(already) })}
        </p>
      ) : null}
      <Chip
        id={fieldId(`${path}.isAcknowledged`)}
        label={t('signature.agree')}
        {...form.register(`${path}.isAcknowledged`)}
      />
      {isAcknowledged ? (
        <SigningDetails
          statement={statement}
          others={signees.filter((person) => person.guestId !== signer)}
        />
      ) : null}
    </Fieldset>
  );
}

/**
 * The host's statements, for everyone coming who has not agreed to their current wording
 * (docs/API.md §11; design PD-52). Shown once someone is coming, whoever answers for them.
 */
export function SignatureSections() {
  const { signatures, venueIds } = useReplyForm();
  const values = useCurrentValues();
  if (!signatures) return null;
  const people = attendingPeople(values, signatures.signer, venueIds);
  const sections = signatures.statements.flatMap((statement) => {
    const covered = signatures.covered.get(statement.questionId);
    const signees = signeesFor(people, covered);
    const already = people.filter((person) => person.guestId && covered?.has(person.guestId));
    return signees.length > 0 ? [{ statement, signees, already }] : [];
  });
  if (sections.length === 0) return null;
  return (
    <div id={fieldId('signatures')} tabIndex={-1} className="grid gap-8 focus:outline-none">
      {sections.map((section) => (
        <StatementSection key={section.statement.questionId} {...section} />
      ))}
    </div>
  );
}
