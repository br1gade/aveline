import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { EventDetail } from '@/features/events';
import { formatEventDay, formatEventTime, type EventZone } from '@/lib/time';

import { deliveryGroupOf } from './delivery';
import type {
  DeliveryReport,
  DeliveryStatus,
  Destination,
  HouseholdDelivery,
  Reachable,
} from './types';

/**
 * One household's invitation, in words, ready to show (design PD-48). Worked out once per report
 * and language, so the guest list's memoized households draw strings and format no dates.
 */
export interface DeliveryText {
  /** What happened, and to whom: "Sent · to Armen Petrosyan · by email, armen@example.am". */
  summary: string;
  /** The backend's own words, in English (FR-33, FR-35): a reason, or the mail server's reply. */
  english: string | null;
  /** What the host can do about it, when there is something to do. */
  action: string | null;
  isAttention: boolean;
}

type T = TFunction<'sending'>;

/** How it went: the channel, and the address when this role may see it. */
export function destinationText(destination: Destination, t: T): string {
  const how = destination.channel ? t(`channel.${destination.channel}`) : '';
  if (!destination.address) return how;
  return how
    ? t('channel.withAddress', { how, address: destination.address })
    : destination.address;
}

function statusText(delivery: Reachable, t: T): string {
  return delivery.isRetrying
    ? t('delivery.status.RETRYING')
    : t(`delivery.status.${delivery.status}`);
}

const SHOWS_REASON = new Set(['FAILED', 'BOUNCED', 'CANCELLED']);

type ActionKey = 'FAILED' | 'BOUNCED' | 'SUPPRESSED' | 'CANCELLED' | 'UNKNOWN';

/** What the host can do, for the statuses that need it ("needs attention"). */
const ACTION_OF: Partial<Record<DeliveryStatus, ActionKey>> = {
  FAILED: 'FAILED',
  BOUNCED: 'BOUNCED',
  SUPPRESSED: 'SUPPRESSED',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN',
};

function reachableText(delivery: Reachable, t: T, zone: EventZone): DeliveryText {
  const when = delivery.sentAt
    ? t('delivery.sentAt', {
        date: formatEventDay(delivery.sentAt, zone),
        time: formatEventTime(delivery.sentAt, zone),
      })
    : '';
  const reminded =
    delivery.reminders > 0 ? t('delivery.reminders', { count: delivery.reminders }) : '';
  const summary = [
    statusText(delivery, t),
    t('delivery.to', { name: delivery.recipient }),
    destinationText(delivery.destination, t),
    when,
    reminded,
  ]
    .filter(Boolean)
    .join(' · ');
  const isReasonShown = delivery.isRetrying || SHOWS_REASON.has(delivery.status);
  const action = ACTION_OF[delivery.status];
  return {
    summary,
    english: isReasonShown ? delivery.failureReason : null,
    action: action ? t(`delivery.action.${action}`) : null,
    isAttention: deliveryGroupOf(delivery) === 'attention',
  };
}

export function deliveryText(delivery: HouseholdDelivery, t: T, zone: EventZone): DeliveryText {
  if (delivery.kind === 'reachable') return reachableText(delivery, t, zone);
  return {
    summary: t('delivery.unreachable'),
    english: delivery.reason,
    action: t('delivery.action.UNREACHABLE'),
    isAttention: true,
  };
}

/** Every household's text, by its id; recomputed only when the report or the language changes. */
export function useDeliveryTexts(
  report: DeliveryReport | null,
  event: EventDetail,
): ReadonlyMap<string, DeliveryText> {
  const { t, i18n } = useTranslation('sending');
  const language = i18n.language;
  return useMemo(() => {
    const texts = new Map<string, DeliveryText>();
    if (!report) return texts;
    const zone = { timeZone: event.timezone, locale: language };
    for (const [householdId, delivery] of report.byHousehold) {
      texts.set(householdId, deliveryText(delivery, t, zone));
    }
    return texts;
  }, [report, event.timezone, language, t]);
}
