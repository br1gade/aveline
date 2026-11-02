import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { TextField } from '@/ui/form';

import { isComing } from '../attendance';
import { LIMITS } from '../schemas';
import type { PersonValues } from '../types';
import { AttendeeDetails } from './attendee-details';
import { fieldId, useCheckoutForm, useCheckoutSetting, useFieldError } from './checkout-context';
import { VenueChoices } from './venue-choices';

/**
 * "This ticket is for me": copies the buyer's own name and contacts onto this ticket, explicitly,
 * on one ticket at most (design PD-79). Nothing is ever copied without it.
 */
function BuyerToggle({ index }: { index: number }) {
  const { t } = useTranslation('checkout');
  const { register, getValues, setValue } = useCheckoutForm();
  const people = useWatch<{ people: Array<{ isBuyer: boolean }> }, 'people'>({ name: 'people' });
  const isTaken = people.some((person, other) => other !== index && person.isBuyer);
  const error = useFieldError(`people.${index}.isBuyer`);
  const field = register(`people.${index}.isBuyer`, {
    onChange: (event: { target: { checked: boolean } }) => {
      if (!event.target.checked) return;
      const buyer = getValues();
      setValue(`people.${index}.firstName`, buyer.buyerFirstName, { shouldValidate: false });
      setValue(`people.${index}.lastName`, buyer.buyerLastName);
      setValue(`people.${index}.email`, buyer.buyerEmail);
      setValue(`people.${index}.phone`, buyer.buyerPhone);
    },
  });
  return (
    <div className="grid gap-1">
      <label className="flex min-h-(--target-min) cursor-pointer items-center gap-3 has-disabled:cursor-not-allowed has-disabled:opacity-60">
        <input type="checkbox" className="accent-action size-5" disabled={isTaken} {...field} />
        {t('people.forMe')}
      </label>
      {error ? <p className="text-error m-0 text-sm">{error}</p> : null}
    </div>
  );
}

function NameAndContacts({ index }: { index: number }) {
  const { t } = useTranslation('checkout');
  const { register } = useCheckoutForm();
  const path = (field: 'firstName' | 'lastName' | 'email' | 'phone') =>
    `people.${index}.${field}` as const;
  const errors = {
    firstName: useFieldError(path('firstName')),
    lastName: useFieldError(path('lastName')),
    email: useFieldError(path('email')),
    phone: useFieldError(path('phone')),
  };
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          id={fieldId(path('firstName'))}
          label={t('fields.firstName')}
          maxLength={LIMITS.name}
          error={errors.firstName}
          {...register(path('firstName'))}
        />
        <TextField
          id={fieldId(path('lastName'))}
          label={t('fields.lastName')}
          optionalText={t('fields.optional')}
          maxLength={LIMITS.name}
          error={errors.lastName}
          {...register(path('lastName'))}
        />
      </div>
      <TextField
        id={fieldId(path('email'))}
        type="email"
        label={t('fields.email')}
        optionalText={t('fields.optional')}
        help={t('people.emailHelp')}
        maxLength={LIMITS.email}
        error={errors.email}
        {...register(path('email'))}
      />
      <TextField
        id={fieldId(path('phone'))}
        type="tel"
        label={t('fields.phone')}
        optionalText={t('fields.optional')}
        maxLength={LIMITS.phone}
        error={errors.phone}
        {...register(path('phone'))}
      />
    </>
  );
}

/**
 * One person's own fields, without the buyer's: who they are, their contacts, where they come and,
 * when coming, what they need. The hosts' registration of a legacy ticket uses them alone.
 */
export function PersonFields({ index }: { index: number }) {
  const { t } = useTranslation('checkout');
  const { rules } = useCheckoutSetting();
  const person = useWatch<{ people: PersonValues[] }, `people.${number}`>({
    name: `people.${index}`,
  });
  return (
    <>
      <NameAndContacts index={index} />
      <VenueChoices index={index} name={person.firstName.trim() || t('people.thisPerson')} />
      {isComing(rules, person) ? <AttendeeDetails index={index} /> : null}
    </>
  );
}

/** One person, on one ticket: who they are, their own contacts, where they come and what they need. */
export function AttendeeCard({ index, total }: { index: number; total: number }) {
  const { t } = useTranslation('checkout');
  const { event, rules } = useCheckoutSetting();
  const person = useWatch<{ people: PersonValues[] }, `people.${number}`>({
    name: `people.${index}`,
  });
  const type = event.ticketTypes.find((candidate) => candidate.id === person.ticketTypeId);
  const name = person.firstName.trim() || t('people.thisPerson');
  const headingId = `person-${index}-heading`;
  return (
    <section aria-labelledby={headingId} className="border-line grid gap-5 border p-5">
      <h3 id={headingId} className="type-heading-3 text-heading m-0">
        {t('people.ticket', {
          number: index + 1,
          total,
          type: type?.name ?? t('people.ticketType'),
        })}
      </h3>
      <BuyerToggle index={index} />
      <NameAndContacts index={index} />
      <VenueChoices index={index} name={name} />
      {isComing(rules, person) ? <AttendeeDetails index={index} /> : null}
    </section>
  );
}
