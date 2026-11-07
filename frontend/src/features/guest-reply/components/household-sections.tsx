import { Controller, useFieldArray, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { Button, Icon } from '@/ui';
import { ChoiceCard, Fieldset, Segmented, TextField } from '@/ui/form';

import { effectiveVenues, summarize, type VenueChoice } from '../attendance';
import { fieldId } from '../fields';
import { answerableQuestions, newPartyRow } from '../form-model';
import { LIMITS } from '../options';
import type { ReplyStatus } from '../types';
import { DietaryFields } from './detail-sections';
import { useFieldError, useReplyForm } from './form-context';
import { QuestionSection, type AnswerOwner } from './question-section';

const STATUSES: readonly ReplyStatus[] = ['ATTENDING', 'DECLINED', 'UNDECIDED'];

/**
 * The three answers as choice cards, nothing chosen until the guest chooses (spec §6.1). When the
 * event asks per venue, the same three for each venue, in the host's order (design PD-50).
 */
export function AnswerSection() {
  const { t } = useTranslation('reply');
  const { form, venues } = useReplyForm();
  const error = useFieldError('status');
  if (venues.length > 0) return <VenueAnswers venues={venues} />;
  return (
    <Fieldset id={fieldId('status')} legend={t('answer.legend')} error={error}>
      {STATUSES.map((status) => (
        <ChoiceCard
          key={status}
          label={t(`answer.${status}`)}
          value={status}
          {...form.register('status')}
        />
      ))}
    </Fieldset>
  );
}

function VenueAnswers({ venues }: { venues: readonly VenueChoice[] }) {
  const { t } = useTranslation('reply');
  return (
    <Fieldset id={fieldId('status')} legend={t('answer.legend')}>
      <p className="text-ink-muted m-0 text-sm leading-[22px]">{t('venues.lead')}</p>
      {venues.map((venue) => (
        <VenueAnswer key={venue.venueId} venue={venue} />
      ))}
    </Fieldset>
  );
}

function VenueAnswer({ venue }: { venue: VenueChoice }) {
  const { t } = useTranslation('reply');
  const { form } = useReplyForm();
  const path = `venues.${venue.venueId}` as const;
  const error = useFieldError(path);
  return (
    <Fieldset id={fieldId(path)} legend={venue.label} error={error}>
      {STATUSES.map((status) => (
        <ChoiceCard
          key={status}
          label={t(`answer.${status}`)}
          value={status}
          {...form.register(path)}
        />
      ))}
    </Fieldset>
  );
}

/**
 * A member's answer at each venue, starting on the respondent's ("same as me", PD-28) until
 * changed. Nobody follows on the server in PER_VENUE, so what is shown is what is sent.
 */
function MemberVenues({ index, name }: { index: number; name: string }) {
  const { t } = useTranslation('reply');
  const { form, venues, venueIds } = useReplyForm();
  const [respondent, own] = useWatch({
    control: form.control,
    name: ['venues', `members.${index}.venues`],
  });
  const effective = effectiveVenues(own, respondent, venueIds);
  const options = STATUSES.map((value) => ({ value, label: t(`household.${value}`) }));
  return (
    <div className="grid gap-3">
      <p className="text-ink m-0 text-base leading-6 font-medium">{name}</p>
      {venues.map((venue) => (
        <Controller
          key={venue.venueId}
          control={form.control}
          name={`members.${index}.venues.${venue.venueId}`}
          render={({ field }) => (
            <Segmented
              legend={t('venues.memberAt', { name, venue: venue.label })}
              name={field.name}
              value={effective[venue.venueId] ?? ''}
              options={options}
              onChange={field.onChange}
            />
          )}
        />
      ))}
      {summarize(venueIds, effective) === 'ATTENDING' ? (
        <PersonAnswers owner={{ kind: 'member', index }} name={name} />
      ) : null}
    </div>
  );
}

/**
 * Everyone else in the household, each answered for apart (spec §6.1a, PD-28). A member starts on
 * the respondent's answer until changed, and the list stays visible so nobody is answered for
 * unseen. Each member who is coming answers the host's questions for themselves (PD-38).
 */
export function HouseholdSection() {
  const { t } = useTranslation('reply');
  const { form, record, status, venues } = useReplyForm();
  const members = form.getValues('members');
  const error = useFieldError('members');
  const options = STATUSES.map((value) => ({ value, label: t(`household.${value}`) }));
  return (
    <Fieldset id={fieldId('members')} legend={t('household.title')} error={error}>
      <p className="text-ink-muted m-0 text-sm leading-[22px]">
        {t('household.seats', { count: record.household.seatsAllotted })}
      </p>
      {members.map((member, index) =>
        venues.length > 0 ? (
          <MemberVenues key={member.guestId} index={index} name={member.name} />
        ) : (
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
        ),
      )}
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
