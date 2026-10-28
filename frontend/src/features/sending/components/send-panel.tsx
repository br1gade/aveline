import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { EventDetail } from '@/features/events';
import { Button } from '@/ui/kit/button';

import type { Loaded } from '../load';
import { guestListPath } from '../paths';
import type { DeliveryReport } from '../types';
import { LoadedProblem } from './loaded-problem';
import { RefusalAlert } from './refusal-alert';
import { SendConfirmDialog } from './send-confirm-dialog';
import { SendOutcomeView } from './send-outcome';
import { useSend } from './use-send';

interface SendPanelProps {
  event: EventDetail;
  slug: string;
  isPublished: boolean;
  /** Past its time: the backend refuses to send it, so it is not offered (design PD-55). */
  isExpired: boolean;
  delivery: Loaded<DeliveryReport> | null;
}

/** Why sending is not offered: replies stopped, or the invitation's time ran out. */
function NotOffered({ isExpired }: { isExpired: boolean }) {
  const { t } = useTranslation('sending');
  return <p className="m-0">{t(isExpired ? 'send.expired' : 'send.closed')}</p>;
}

/** Who has been invited so far, with the way to each household on the guest list. */
function DeliverySummary({ report, eventId }: { report: DeliveryReport; eventId: string }) {
  const { t } = useTranslation('sending');
  const linkClass = 'text-primary self-start underline underline-offset-4 hover:no-underline';
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0">
        {[
          t('summary.invited', { count: report.invited }),
          t('summary.notSent', { count: report.notSent }),
          report.unreachable > 0 ? t('summary.unreachable', { count: report.unreachable }) : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <Link to={guestListPath(eventId)} className={linkClass}>
        {t('summary.seeEach')}
      </Link>
    </div>
  );
}

/** The first send's question, while it waits for an answer. */
function Confirmation({
  send,
  report,
}: {
  send: ReturnType<typeof useSend>;
  report: DeliveryReport | null;
}) {
  if (!send.pending) return null;
  return (
    <SendConfirmDialog
      pending={send.pending}
      unreachable={report?.unreachable ?? null}
      onConfirm={send.confirm}
      onCancel={send.cancel}
    />
  );
}

/** Why the report is missing, when it is: this role may not see it, or it failed to load. */
function MissingReport({ delivery }: { delivery: Loaded<DeliveryReport> | null }) {
  const { t } = useTranslation('sending');
  if (!delivery || delivery.kind === 'ready') return null;
  return <LoadedProblem loaded={delivery} refusedText={t('summary.refused')} />;
}

/**
 * Sending the invitation to every household not yet invited (docs/API.md §6; design PD-47). The
 * guest list sends to the households chosen there. A closed invitation is refused by the backend,
 * though the guide names only a draft (BACKEND_REQUESTS §3), so it is not offered then.
 */
export function SendPanel({ event, slug, isPublished, isExpired, delivery }: SendPanelProps) {
  const { t } = useTranslation('sending');
  const report = delivery?.kind === 'ready' ? delivery.value : null;
  const send = useSend({ slug, report });
  return (
    <section aria-labelledby="send-title" className="flex max-w-[40rem] flex-col gap-3">
      <h2 id="send-title" className="m-0 text-lg font-medium">
        {t('send.title')}
      </h2>
      <p className="m-0">{t('send.lead')}</p>
      {report ? <DeliverySummary report={report} eventId={event.id} /> : null}
      <MissingReport delivery={delivery} />
      {send.refusal ? <RefusalAlert refusal={send.refusal} action="send" /> : null}
      {isPublished && !isExpired ? (
        <Button
          // The longest label in the app: it wraps rather than widen a 360 px page (ru, hy).
          className="h-auto min-h-10 self-start py-2 text-left whitespace-normal pointer-coarse:h-auto pointer-coarse:min-h-11"
          disabled={send.isSending}
          onClick={() => send.request({ guestIds: null, households: report?.notSent ?? null })}
        >
          {send.isSending ? t('send.sending') : t('send.everyone')}
        </Button>
      ) : (
        <NotOffered isExpired={isExpired} />
      )}
      {send.outcome ? <SendOutcomeView outcome={send.outcome} eventId={event.id} /> : null}
      <Confirmation send={send} report={report} />
    </section>
  );
}
