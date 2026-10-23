import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { createPublicApi } from '@/api/client';
import { readPublicEnv } from '@/config/env';
import { REPLY_HEADING_ID, type Invitation } from '@/features/invitation-renderer';

import { fetchReply, submitReply, type ReplyLink } from '../api';
import { attendingNames, buildPayload, fullName, type ReplyFormValues } from '../form-model';
import { classifySendError, type SendProblem } from '../server-errors';
import type { ReplyRecord, SubmitResult } from '../types';
import { ReplyForm } from './reply-form';
import { SavedReply, SentReply } from './saved-reply';

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

function useSend(
  props: GuestReplyProps,
  record: ReplyRecord,
  onSaved: (fresh: ReplyRecord, names: string[]) => void,
) {
  const api = useMemo(() => createPublicApi(readPublicEnv().VITE_API_BASE_URL), []);
  return async (values: ReplyFormValues, initial: ReplyFormValues): Promise<SendProblem | null> => {
    try {
      const body = buildPayload(values, initial, props.invitation.rsvpQuestions);
      const result = await submitReply(api, props.link, body);
      const fresh = await fetchReply(api, props.link).catch(() => withResult(record, result));
      onSaved(fresh, attendingNames(values, fullName(record.guest)));
      return null;
    } catch (error) {
      return classifySendError(error);
    }
  };
}

/**
 * The reply section's content on a personal link (spec §6): the saved reply, the form, or the
 * confirmation. Once replies close, only the last reply shows.
 */
export function GuestReply(props: GuestReplyProps) {
  const { invitation, onReplied, onSentChange } = props;
  const [record, setRecord] = useState(props.record);
  const [view, setView] = useState<View>(record.rsvp.status === 'PENDING' ? 'form' : 'saved');
  const [names, setNames] = useState<string[]>([]);
  const zone = { timeZone: invitation.event.timezone, locale: invitation.locale };

  useEffect(() => {
    if (view === 'sent') document.getElementById(REPLY_HEADING_ID)?.focus();
  }, [view]);

  const send = useSend(props, record, (fresh, coming) => {
    setRecord(fresh);
    setNames(coming);
    setView('sent');
    onReplied(fresh);
    onSentChange(true);
  });
  function change() {
    setView('form');
    onSentChange(false);
  }

  if (!invitation.isAcceptingResponses) {
    return record.rsvp.status === 'PENDING' ? null : (
      <Card>
        <SavedReply record={record} zone={zone} />
      </Card>
    );
  }
  return (
    <Card>
      {view === 'form' ? <ReplyForm invitation={invitation} record={record} onSend={send} /> : null}
      {view === 'sent' ? <SentReply names={names} onChange={change} /> : null}
      {view === 'saved' ? <SavedReply record={record} zone={zone} onChange={change} /> : null}
    </Card>
  );
}
