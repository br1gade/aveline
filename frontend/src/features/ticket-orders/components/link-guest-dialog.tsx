import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Loaded } from '@/api/loaded';
import { browserSession } from '@/api/session';
import type { Household } from '@/features/guests';
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
import { Field, FieldLabel } from '@/ui/kit/field';
import { NativeSelect, NativeSelectOption } from '@/ui/kit/native-select';

import { linkGuest } from '../api';
import { linkBody, linkCandidates } from '../payload';
import { reconcileRefusal, type ReconcileRefusal } from '../refusals';
import type { OrderTicket } from '../types';
import { RefusalText, useRefusalWords } from './refusal-text';

interface LinkGuestProps {
  eventId: string;
  ticket: OrderTicket;
  holder: string;
  guests: Loaded<Household[]>;
  page: PageActions;
  onClose: () => void;
}

function useLink(
  { eventId, ticket, holder, page, onClose }: LinkGuestProps,
  labelOf: (guestId: string) => string,
) {
  const { t } = useTranslation('ticket-orders');
  const [isBusy, setIsBusy] = useState(false);
  const [refusal, setRefusal] = useState<ReconcileRefusal | null>(null);
  const link = async (guestId: string) => {
    setRefusal(null);
    setIsBusy(true);
    try {
      await linkGuest(browserSession().api, eventId, ticket.id, linkBody(ticket, guestId));
      onClose();
      await page.done(t('link.done', { holder, guest: labelOf(guestId) }));
    } catch (error) {
      const refused = reconcileRefusal(error);
      setRefusal(refused);
      if (refused.kind === 'changed' || refused.kind === 'gone') page.reload();
    } finally {
      setIsBusy(false);
    }
  };
  return { isBusy, refusal, link };
}

interface ChoiceProps {
  candidates: ReturnType<typeof linkCandidates>;
  guestId: string;
  onChoose: (guestId: string) => void;
}

function GuestChoice({ candidates, guestId, onChoose }: ChoiceProps) {
  const { t } = useTranslation('ticket-orders');
  return (
    <Field className="gap-2">
      <FieldLabel htmlFor="link-guest">{t('link.guest')}</FieldLabel>
      <NativeSelect
        id="link-guest"
        value={guestId}
        onChange={(change) => onChoose(change.target.value)}
      >
        <NativeSelectOption value="">{t('link.choose')}</NativeSelectOption>
        {candidates.map((candidate) => (
          <NativeSelectOption key={candidate.guestId} value={candidate.guestId}>
            {candidate.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}

/**
 * Linking an invited guest to a ticket (design PD-89): one of the guest list's people, whose own
 * answers are kept; a guest checkout made for the ticket is archived. Refusals by their words.
 */
export function LinkGuestDialog(props: LinkGuestProps) {
  const { t } = useTranslation('ticket-orders');
  const { ticket, holder, guests, page, onClose } = props;
  const words = useRefusalWords();
  const candidates = guests.kind === 'ready' ? linkCandidates(guests.value, ticket) : [];
  const [guestId, setGuestId] = useState('');
  const labelOf = (id: string) =>
    candidates.find((candidate) => candidate.guestId === id)?.label ?? '';
  const { isBusy, refusal, link } = useLink(props, labelOf);
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent className="sm:max-w-[30rem]" onCloseAutoFocus={page.focusStatus}>
        <DialogHeader>
          <DialogTitle>{t('link.title', { holder })}</DialogTitle>
          <DialogDescription>{t('link.lead')}</DialogDescription>
        </DialogHeader>
        {guests.kind === 'ready' ? (
          <GuestChoice candidates={candidates} guestId={guestId} onChoose={setGuestId} />
        ) : (
          <p className="m-0">
            {t(guests.kind === 'refused' ? 'link.noGuestsRole' : 'link.noGuests')}
          </p>
        )}
        {refusal ? <RefusalText refusal={refusal} words={words.reconcile(refusal)} /> : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {t('close')}
            </Button>
          </DialogClose>
          <Button disabled={!guestId || isBusy} onClick={() => void link(guestId)}>
            {t('link.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
