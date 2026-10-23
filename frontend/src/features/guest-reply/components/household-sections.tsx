import { Controller, useFieldArray } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { Button, Icon } from '@/ui';
import { ChoiceCard, Fieldset, Segmented, TextField } from '@/ui/form';

import { fieldId } from '../fields';
import { LIMITS } from '../options';
import type { ReplyStatus } from '../types';
import { DietaryChips } from './detail-sections';
import { useFieldError, useReplyForm } from './form-context';

const STATUSES: readonly ReplyStatus[] = ['ATTENDING', 'DECLINED', 'UNDECIDED'];

/** The three answers as choice cards, nothing chosen until the guest chooses (spec §6.1). */
export function AnswerSection() {
  const { t } = useTranslation('reply');
  const { form } = useReplyForm();
  const error = useFieldError('status', form.formState.errors.status?.message);
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
 * unseen. Attending members can be given their own dietary needs, folded away.
 */
export function HouseholdSection() {
  const { t } = useTranslation('reply');
  const { form, record, status } = useReplyForm();
  const members = form.getValues('members');
  const error = useFieldError('members', undefined);
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
                  <MemberDietary index={index} name={member.name} />
                ) : null}
              </div>
            );
          }}
        />
      ))}
    </Fieldset>
  );
}

function MemberDietary({ index, name }: { index: number; name: string }) {
  const { t } = useTranslation('reply');
  const { form, record } = useReplyForm();
  const error = useFieldError(
    `members.${index}.dietaryNotes`,
    form.formState.errors.members?.[index]?.dietaryNotes?.message,
  );
  return (
    <details className="group" open={Boolean(error)}>
      <summary className="text-action inline-flex min-h-(--target-min) cursor-pointer list-none items-center gap-2 text-sm underline underline-offset-3 [&::-webkit-details-marker]:hidden">
        <Icon
          name="chevron-down"
          size={16}
          className="transition-transform group-open:rotate-180"
        />
        {t('household.dietaryFor', { name })}
      </summary>
      <div className="grid gap-3 pt-2">
        <DietaryChips
          name={`members.${index}.dietary`}
          saved={record.household.members[index]?.dietary ?? []}
        />
        <TextField
          id={fieldId(`members.${index}.dietaryNotes`)}
          label={t('dietary.notes')}
          maxLength={LIMITS.dietaryNotes}
          error={error}
          {...form.register(`members.${index}.dietaryNotes`)}
        />
      </div>
    </details>
  );
}

/** Guests to add while seats remain (spec §6.1b): a first name and an optional last name each. */
export function PartySection({ seatsLeft }: { seatsLeft: number }) {
  const { t } = useTranslation('reply');
  const { form } = useReplyForm();
  const rows = useFieldArray({ control: form.control, name: 'party' });
  const error = useFieldError('party', undefined);
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
          onClick={() => rows.append({ firstName: '', lastName: '' })}
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
  const firstNameError = useFieldError(
    `party.${index}.firstName`,
    form.formState.errors.party?.[index]?.firstName?.message,
  );
  return (
    <div className="border-hairline grid gap-3 border p-4">
      <p className="text-ink m-0 text-sm font-medium">{t('party.guest', { number: index + 1 })}</p>
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
      <Button variant="quiet" className="self-start px-0" onClick={onRemove}>
        <Icon name="minus" />
        {t('party.remove')}
      </Button>
    </div>
  );
}
