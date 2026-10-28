import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { createPublicApi, type ApiClient } from '@/api/client';
import { readPublicEnv } from '@/config/env';
import { REPLY_HEADING_ID, type Invitation } from '@/features/invitation-renderer';
import { Notice } from '@/ui';

import { fetchReply, submitReply, type ReplyLink } from '../api';
import { venueChoices } from '../attendance';
import { fullName, type ReplyFormValues } from '../form-model';
import { fieldConfig } from '../options';
import { attendingNames, buildPayload, type PayloadContext } from '../payload';
import { classifySendError, type SendProblem } from '../server-errors';
import type { SignatureContext } from '../signatures';
import type { ReplyRecord, SubmitResult } from '../types';
import { ReplyForm } from './reply-form';
import { SavedReply, SentReply } from './saved-reply';
import { useSignatureContext, useSigning } from './use-signing';

type View = 'saved' | 'form' | 'sent';

export interface GuestReplyProps {
  invitation: Invitation;
  link: ReplyLink;
  record: ReplyRecord;
  /** The saved reply after a send, for the personal card and the reply bar. */
  onReplied: (record: ReplyRecord) => void;
  /** Whether the confirmation is showing, so the section's heading can say "Thank you". */
  onSentChange: (isSent: boolean) => void;
}

/** The form sits on a light card inside the burgundy band: errors and success pass only there. */
function Card({ children }: { children: ReactNode }) {
  return (
    <div data-theme="ivory" className="bg-porcelain text-ink p-6 sm:p-8">
      {children}
    </div>
  );
}

/** If the fresh read fails after a successful send, the answer itself is still known. */
function withResult(record: ReplyRecord, result: SubmitResult): ReplyRecord {
  return {
    ...record,
    rsvp: { ...record.rsvp, status: result.status, respondedAt: result.respondedAt },
  };
}

/** What a send needs besides the form: the page, its client, the reply as read, the statements. */
interface SendSetup {
  props: GuestReplyProps;
  api: ApiClient;
  record: ReplyRecord;
  signatures: SignatureContext | null;
}

/**
 * How the invitation asks its questions, and the page's language when it is not the one stored
 * for the guest (they switched, or none was stored): replying stores it, so their confirmation and
 * reminders come in the language they read. The attendance revision and venues come from the
 * reply as it was read, so a change of mode meanwhile is refused rather than misread.
 */
function payloadContext({ props, record, signatures }: SendSetup): PayloadContext {
  const { invitation } = props;
  const isSwitched = invitation.guest !== null && invitation.locale !== invitation.guest.locale;
  return {
    questions: invitation.rsvpQuestions,
    field: (name) => fieldConfig(invitation, name),
    locale: isSwitched ? invitation.locale : undefined,
    attendance: {
      revision: record.attendance.revision,
      venueIds: venueChoices(record, invitation).map((venue) => venue.venueId),
    },
    signatures: signatures ?? undefined,
  };
}

function sender(setup: SendSetup, onSaved: (fresh: ReplyRecord, names: string[]) => void) {
  const { props, api, record } = setup;
  return async (values: ReplyFormValues, initial: ReplyFormValues): Promise<SendProblem | null> => {
    try {
      const context = payloadContext(setup);
      const body = buildPayload(values, initial, context);
      const result = await submitReply(api, props.link, body);
      const fresh = await fetchReply(api, props.link).catch(() => withResult(record, result));
      onSaved(fresh, attendingNames(values, fullName(record.guest), context.attendance.venueIds));
      return null;
    } catch (error) {
      return classifySendError(error, {
        memberIds: values.members.map((member) => member.guestId),
        partyFirstNames: values.party.map((row) => row.firstName),
      });
    }
  };
}

/** What the form was showing before a reload, and a key that starts it again from there. */
interface Reloaded {
  draft: ReplyFormValues | null;
  generation: number;
  isFailed: boolean;
}

/**
 * Reads the reply again after the invitation changed underneath the guest (design PD-51), and
 * starts the form again from the fresh reply with what they typed carried over.
 */
function useReload(api: ApiClient, link: ReplyLink, onFresh: (fresh: ReplyRecord) => void) {
  const [reloaded, setReloaded] = useState<Reloaded>({
    draft: null,
    generation: 0,
    isFailed: false,
  });
  const reload = async (typed: ReplyFormValues) => {
    try {
      const fresh = await fetchReply(api, link);
      onFresh(fresh);
      setReloaded((before) => ({
        draft: typed,
        generation: before.generation + 1,
        isFailed: false,
      }));
    } catch {
      setReloaded((before) => ({ ...before, isFailed: true }));
    }
  };
  return { reloaded, reload };
}

/** Who in the household has agreed to each statement, for the saved reply. */
function agreedNames(record: ReplyRecord, signatures: SignatureContext | null): string[] {
  if (!signatures) return [];
  const people = [record.guest, ...record.household.members];
  return signatures.statements.flatMap(({ questionId }) => {
    const covered = signatures.covered.get(questionId);
    const named = people.filter((person) => covered?.has(person.id)).map(fullName);
    return named.length > 0 ? [named.join(', ')] : [];
  });
}

/** The page's state: the reply as last read, which view shows, and when to read agreements. */
function useReplyState(props: GuestReplyProps) {
  const [record, setRecord] = useState(props.record);
  const [view, setView] = useState<View>(record.rsvp.status === 'PENDING' ? 'form' : 'saved');
  const [names, setNames] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const update = (fresh: ReplyRecord) => {
    setRecord(fresh);
    setRefresh((count) => count + 1);
    props.onReplied(fresh);
  };
  return { record, view, setView, names, setNames, refresh, update };
}

/**
 * The reply section's content on a personal link (spec §6): the saved reply, the form, or the
 * confirmation. Once replies close, only the last reply shows.
 */
export function GuestReply(props: GuestReplyProps) {
  const { invitation, link, onSentChange } = props;
  const { t } = useTranslation('reply');
  const { locale } = invitation;
  const api = useMemo(
    () => createPublicApi(readPublicEnv().VITE_API_BASE_URL, { getLanguage: () => locale }),
    [locale],
  );
  const state = useReplyState(props);
  const { record, view } = state;
  const signatures = useSignatureContext(api, { ...state, link, invitation });
  const signing = useSigning(api, link);
  const zone = { timeZone: invitation.event.timezone, locale };
  const venues = venueChoices(record, invitation);
  const agreed = agreedNames(record, signatures);
  const { reloaded, reload } = useReload(api, link, state.update);

  useEffect(() => {
    if (view === 'sent') document.getElementById(REPLY_HEADING_ID)?.focus();
  }, [view]);

  const send = sender({ props, api, record, signatures }, (fresh, coming) => {
    state.update(fresh);
    state.setNames(coming);
    state.setView('sent');
    onSentChange(true);
  });
  function change() {
    state.setView('form');
    onSentChange(false);
  }

  const saved = { record, venues, agreed, zone };
  if (!invitation.isAcceptingResponses) {
    return record.rsvp.status === 'PENDING' ? null : (
      <Card>
        <SavedReply {...saved} />
      </Card>
    );
  }
  return (
    <Card>
      {reloaded.isFailed ? <Notice tone="error">{t('errors.loadFailed')}</Notice> : null}
      {view === 'form' ? (
        <ReplyForm
          key={reloaded.generation}
          invitation={invitation}
          record={record}
          draft={reloaded.draft}
          signatures={signatures}
          signing={signing}
          onSend={send}
          onReload={(typed) => void reload(typed)}
        />
      ) : null}
      {view === 'sent' ? <SentReply names={state.names} onChange={change} /> : null}
      {view === 'saved' ? <SavedReply {...saved} onChange={change} /> : null}
    </Card>
  );
}
