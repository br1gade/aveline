import type { DeliveryStatus, HouseholdDelivery } from './types';

/**
 * The guest list's invitation filter (design PD-48): what a host asks of the report. "Needs
 * attention" gathers everything they can act on: a failure, a bounce, a suppression, a withdrawn
 * message, a status the client does not know, and a household nothing can reach.
 */
export const DELIVERY_GROUPS = ['notSent', 'onItsWay', 'sent', 'attention'] as const;
export type DeliveryGroup = (typeof DELIVERY_GROUPS)[number];

const GROUP_OF_STATUS: Readonly<Record<DeliveryStatus, DeliveryGroup>> = {
  NOT_SENT: 'notSent',
  QUEUED: 'onItsWay',
  SENDING: 'onItsWay',
  SENT: 'sent',
  DELIVERED: 'sent',
  FAILED: 'attention',
  BOUNCED: 'attention',
  SUPPRESSED: 'attention',
  CANCELLED: 'attention',
  UNKNOWN: 'attention',
};

/** A household the report does not mention has no group, and no filter but "any" shows it. */
export function deliveryGroupOf(delivery: HouseholdDelivery | undefined): DeliveryGroup | null {
  if (!delivery) return null;
  return delivery.kind === 'unreachable' ? 'attention' : GROUP_OF_STATUS[delivery.status];
}

export function isDeliveryGroup(value: string): value is DeliveryGroup {
  return (DELIVERY_GROUPS as readonly string[]).includes(value);
}
