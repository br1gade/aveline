import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { HolderForm, type AttendeeBody } from '@/features/checkout';
import { fetchPublicEvent, type PublicEvent } from '@/features/public-event';
import { getListing } from '@/features/ticket-sales';
import type { PageActions } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/kit/dialog';

import { registerHolder } from '../api';
import { registerBody } from '../payload';
import { reconcileRefusal, type ReconcileRefusal } from '../refusals';
import type { OrderTicket } from '../types';
import { RefusalText, useRefusalWords } from './refusal-text';

type Rules =
  | { kind: 'loading' }
  | { kind: 'ready'; event: PublicEvent }
  | { kind: 'unpublished' }
  | { kind: 'failed' };

/**
 * Checkout's own rules for one person, read when the dialog opens: the published announcement's
 * `checkout` (FR-71). `version` reads them again, after the hosts changed how guests answer.
 */
function useRules(eventId: string, version: number): Rules {
  const { i18n } = useTranslation();
  const [rules, setRules] = useState<Rules>({ kind: 'loading' });
  useEffect(() => {
    let isCurrent = true;
    const { api } = browserSession();
    void getListing(api, eventId)
      .then(async (listing) => {
        if (!listing?.publishedAt) return { kind: 'unpublished' } as const;
        return {
          kind: 'ready',
          event: await fetchPublicEvent(api, { slug: listing.slug, locale: i18n.language }),
        } as const;
      })
      .catch(() => ({ kind: 'failed' }) as const)
      .then((next) => isCurrent && setRules(next));
    return () => {
      isCurrent = false;
    };
  }, [eventId, version, i18n.language]);
  return rules;
}

interface RegisterProps {
  eventId: string;
  ticket: OrderTicket;
  page: PageActions;
  onClose: () => void;
}

function useRegister({ eventId, ticket, page, onClose }: RegisterProps) {
  const { t } = useTranslation('ticket-orders');
  const [version, setVersion] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [refusal, setRefusal] = useState<ReconcileRefusal | null>(null);
  const register = async (attendee: AttendeeBody, revision: number) => {
    setRefusal(null);
    setIsBusy(true);
    try {
      await registerHolder(
        browserSession().api,
        eventId,
        ticket.id,
        registerBody(attendee, revision),
      );
      onClose();
      await page.done(t('register.done', { name: attendee.firstName }));
    } catch (error) {
      const refused = reconcileRefusal(error);
      setRefusal(refused);
      if (refused.kind === 'staleRevision') setVersion((count) => count + 1);
      if (refused.kind === 'hasAttendee' || refused.kind === 'gone') page.reload();
    } finally {
      setIsBusy(false);
    }
  };
  return { version, isBusy, refusal, register };
}

/**
 * Registering who holds a ticket sold before named checkout (design PD-89): one person, with
 * checkout's own fields and rules, for this ticket's type. It never issues another code.
 */
export function RegisterDialog(props: RegisterProps) {
  const { t } = useTranslation('ticket-orders');
  const { ticket, page, onClose } = props;
  const words = useRefusalWords();
  const { version, isBusy, refusal, register } = useRegister(props);
  const rules = useRules(props.eventId, version);
  const lead = ticket.holderName
    ? t('register.leadNamed', { holder: ticket.holderName })
    : t('register.lead');
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent
        className="max-h-[90svh] overflow-y-auto sm:max-w-[34rem]"
        onCloseAutoFocus={page.focusStatus}
      >
        <DialogHeader>
          <DialogTitle>{t('register.title')}</DialogTitle>
          <DialogDescription>{lead}</DialogDescription>
        </DialogHeader>
        {rules.kind === 'loading' ? (
          <p role="status" className="m-0">
            {t('register.loading')}
          </p>
        ) : null}
        {rules.kind === 'unpublished' || rules.kind === 'failed' ? (
          <p className="m-0">{t(`register.${rules.kind}`)}</p>
        ) : null}
        {refusal ? <RefusalText refusal={refusal} words={words.reconcile(refusal)} /> : null}
        {rules.kind === 'ready' ? (
          <HolderForm
            key={rules.event.checkout.attendanceRevision}
            event={rules.event}
            ticketTypeId={ticket.ticketTypeId}
            submitLabel={t('register.confirm')}
            isBusy={isBusy}
            onSubmit={(attendee) => register(attendee, rules.event.checkout.attendanceRevision)}
          />
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {t('close')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
