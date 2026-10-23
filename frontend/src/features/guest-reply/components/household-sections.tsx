import { Controller, useFieldArray, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { Button, Icon } from '@/ui';
import { ChoiceCard, Fieldset, Segmented, TextField } from '@/ui/form';

import { fieldId } from '../fields';
import { answerableQuestions, newPartyRow } from '../form-model';
import { LIMITS } from '../options';
import type { ReplyStatus } from '../types';
import { DietaryFields } from './detail-sections';
import { useFieldError, useReplyForm } from './form-context';
import { QuestionSection, type AnswerOwner } from './question-section';

const STATUSES: readonly ReplyStatus[] = ['ATTENDING', 'DECLINED', 'UNDECIDED'];

/** The three answers as choice cards, nothing chosen until the guest chooses (spec §6.1). */
export function AnswerSection() {
  const { t } = useTranslation('reply');
  const error = useFieldError('status');
  return (
    <Fieldset id={fieldId('status')} legend={t('answer.legend')} error={error}>
      {STATUSES.map((status) => (
        <ChoiceCardFor key={status} status={status} />
      ))}
    </Fieldset>
  );
}

function ChoiceCardFor({ status }: { status: ReplyStatus }) {
  const { t } = useTranslation('reply');
  const { form } = useReplyForm();
  return <ChoiceCard label={t(`answer.${status}`)} value={status} {...form.register('status')} />;
}

/**
 * Everyone else in the household, each answered for apart (spec §6.1a, PD-28). A member starts on
 * the respondent's answer until changed, and the list stays visible so nobody is answered for
 * unseen. Each member who is coming answers the host's questions for themselves (PD-38).
 */
export function HouseholdSection() {
  const { t } = useTranslation('reply');
  const { form, record, status } = useReplyForm();
  const members = form.getValues('members');
  const error = useFieldError('members');
  const options = STATUSES.map((value) => ({ value, label: t(`household.${value}`) }));
  return (
    <Fieldset id={fieldId('members')} legend={t('household.title')} error={error}>
      <p className="text-ink-muted m-0 text-sm leading-[22px]">
        {t('household.seats', { count: record.household.seatsAllotted })}
      </p>
      {members.map((member, index) => (
        <Controller
          key={member.guestId}
          control={form.control}
          name={`members.${index}.status`}
          render={({ field }) => {
            const effective = field.value || status;
            return (
              <div className="grid gap-2">
                <Segmented
                  legend={member.name}
                  name={field.name}
                  value={effective}
                  options={options}
                  onChange={field.onChange}
                />
                {effective === 'ATTENDING' ? (
                  <PersonAnswers owner={{ kind: 'member', index }} name={member.name} />
                ) : null}
              </div>
            );
          }}
        />
      ))}
    </Fieldset>
  );
}

/**
 * Someone else's own answers (PD-38): the host's questions, which bind everyone who is coming
 * (docs/API.md §4), then their dietary needs, folded away as spec §6.1d draws them.
 */
function PersonAnswers({
  owner,
  name,
}: {
  owner: Exclude<AnswerOwner, { kind: 'respondent' }>;
  name: string;
}) {
  const { t } = useTranslation('reply');
  const { invitation, field } = useReplyForm();
  const notesPath = `${owner.kind === 'member' ? 'members' : 'party'}.${owner.index}.dietaryNotes`;
  const hasNotesError = Boolean(useFieldError(notesPath));
  const hasQuestions = answerableQuestions(invitation.rsvpQuestions).length > 0;
  const isDietaryAsked = field('dietary').isEnabled;
  if (!hasQuestions && !isDietaryAsked) return null;
  return (
    <div className="border-hairline grid gap-6 border-l pl-4">
      {hasQuestions ? <QuestionSection owner={owner} /> : null}
      {isDietaryAsked ? (
        <details className="group" open={hasNotesError || undefined}>
          <summary className="text-action inline-flex min-h-(--target-min) cursor-pointer list-none items-center gap-2 text-sm underline underline-offset-3 [&::-webkit-details-marker]:hidden">
            <Icon
              name="chevron-down"
              size={16}
              className="transition-transform group-open:rotate-180"
            />
            {t('household.dietaryFor', { name })}
          </summary>
          <div className="pt-2">
            <DietaryFields owner={owner} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Guests to add while seats remain (spec §6.1b): a first name, an optional last name, and their
 * own answers. They come with the respondent, so they are asked what anyone coming is asked.
 */
export function PartySection({ seatsLeft }: { seatsLeft: number }) {
  const { t } = useTranslation('reply');
  const { form, invitation } = useReplyForm();
  const rows = useFieldArray({ control: form.control, name: 'party' });
  const error = useFieldError('party');
  const remaining = seatsLeft - rows.fields.length;
  return (
    <Fieldset id={fieldId('party')} legend={t('party.title')} error={error}>
      <p className="text-ink-muted m-0 text-sm leading-[22px]">
        {t('party.remaining', { count: remaining })}
      </p>
      {rows.fields.map((row, index) => (
        <PartyRow key={row.id} index={index} onRemove={() => rows.remove(index)} />
      ))}
      {remaining > 0 ? (
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => rows.append(newPartyRow(invitation.rsvpQuestions))}
        >
          <Icon name="plus" />
          {t('party.add')}
        </Button>
      ) : null}
    </Fieldset>
  );
}

function PartyRow({ index, onRemove }: { index: number; onRemove: () => void }) {
  const { t } = useTranslation('reply');
  const { form } = useReplyForm();
  const firstNameError = useFieldError(`party.${index}.firstName`);
  const firstName = useWatch({ control: form.control, name: `party.${index}.firstName` });
  const label = t('party.guest', { number: index + 1 });
  return (
    <div className="border-hairline grid gap-3 border p-4">
      <p className="text-ink m-0 text-sm font-medium">{label}</p>
      <TextField
        id={fieldId(`party.${index}.firstName`)}
        label={t('party.firstName')}
        autoComplete="off"
        maxLength={LIMITS.name}
        error={firstNameError}
        {...form.register(`party.${index}.firstName`)}
      />
      <TextField
        id={fieldId(`party.${index}.lastName`)}
        label={t('party.lastName')}
        optionalText={t('question.optional')}
        autoComplete="off"
        maxLength={LIMITS.name}
        {...form.register(`party.${index}.lastName`)}
      />
      <PersonAnswers owner={{ kind: 'party', index }} name={firstName.trim() || label} />
      <Button variant="quiet" className="self-start px-0" onClick={onRemove}>
        <Icon name="minus" />
        {t('party.remove')}
      </Button>
    </div>
  );
}
