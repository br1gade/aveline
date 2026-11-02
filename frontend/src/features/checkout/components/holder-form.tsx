import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { PublicEvent } from '@/features/public-event';
import { useIsHydrated } from '@/ui';
import { Button } from '@/ui/kit/button';

import { attendeeBody } from '../payload';
import { blankPerson } from '../roster';
import { holderSchema } from '../schemas';
import type { AttendeeBody, PersonValues } from '../types';
import { PersonFields } from './attendee-card';
import { CheckoutContext } from './checkout-context';

interface HolderValues {
  people: PersonValues[];
}

export interface HolderFormProps {
  /** The public event, whose `checkout` holds the rules the backend applies to this person. */
  event: PublicEvent;
  ticketTypeId: string;
  submitLabel: string;
  isBusy: boolean;
  onSubmit: (attendee: AttendeeBody) => Promise<void>;
}

/**
 * One named person, with checkout's own fields, checks and body (design PD-89): the hosts'
 * registration of who holds a ticket sold before named checkout. The fields are the guest
 * pages', inside the app's dialog. Posted from JavaScript only (PD-41).
 */
export function HolderForm({
  event,
  ticketTypeId,
  submitLabel,
  isBusy,
  onSubmit,
}: HolderFormProps) {
  const { t } = useTranslation('checkout');
  const isHydrated = useIsHydrated();
  const rules = event.checkout;
  const schema = useMemo(() => holderSchema(rules), [rules]);
  const form = useForm<HolderValues>({
    resolver: zodResolver(schema),
    defaultValues: { people: [blankPerson(ticketTypeId)] },
  });
  const setting = useMemo(() => ({ event, rules, isBusy }), [event, rules, isBusy]);
  const send = (values: HolderValues) => {
    const [person] = values.people;
    return person ? onSubmit(attendeeBody(rules, person)) : Promise.resolve();
  };
  return (
    <CheckoutContext.Provider value={setting}>
      <FormProvider {...form}>
        <form
          method="post"
          noValidate
          data-theme="ivory"
          aria-label={t('people.heading')}
          className="grid gap-5"
          onSubmit={(submitted) => void form.handleSubmit(send)(submitted)}
        >
          <PersonFields index={0} />
          <Button type="submit" className="justify-self-start" disabled={!isHydrated || isBusy}>
            {submitLabel}
          </Button>
        </form>
      </FormProvider>
    </CheckoutContext.Provider>
  );
}
