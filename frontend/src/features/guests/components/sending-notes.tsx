import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { EventDetail } from '@/features/events';
import {
  invitationPath,
  LoadedProblem,
  RefusalAlert,
  SendConfirmDialog,
  SendOutcomeView,
  type DeliveryReport,
  type Loaded,
} from '@/features/sending';

import type { useSendFromList } from './use-send-from-list';

interface SendingNotesProps {
  event: EventDetail;
  delivery: Loaded<DeliveryReport> | null;
  sender: ReturnType<typeof useSendFromList>;
}

/** Where the invitation stands, in a line, with the way to publish and send it. */
function InvitationLine({ event }: { event: EventDetail }) {
  const { t } = useTranslation('guests');
  const { invitation } = event;
  if (!invitation) return null;
  return (
    <p className="m-0 text-sm">
      {t(`invite.${invitation.status}`)}{' '}
      <Link
        to={invitationPath(event.id)}
        className="text-primary underline underline-offset-4 hover:no-underline"
      >
        {t('invite.link')}
      </Link>
    </p>
  );
}

/**
 * The invitation on the guest list (design PD-48): its state, why the delivery report is missing
 * when it is, and what a send from the list did. A report that failed leaves the list standing.
 */
export function SendingNotes({ event, delivery, sender }: SendingNotesProps) {
  const { t } = useTranslation('guests');
  const { send } = sender;
  return (
    <>
      <InvitationLine event={event} />
      {delivery && delivery.kind !== 'ready' ? (
        <LoadedProblem loaded={delivery} refusedText={t('invite.refused')} />
      ) : null}
      {send.refusal ? <RefusalAlert refusal={send.refusal} action="send" /> : null}
      {send.outcome ? <SendOutcomeView outcome={send.outcome} eventId={event.id} /> : null}
      {send.pending ? (
        <SendConfirmDialog
          pending={send.pending}
          unreachable={null}
          onConfirm={send.confirm}
          onCancel={send.cancel}
        />
      ) : null}
    </>
  );
}
