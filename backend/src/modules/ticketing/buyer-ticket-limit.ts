import type { Prisma } from '@prisma/client';
import { DomainHttpException } from '../../common/domain-http.exception';

interface BuyerPurchase {
  eventId: string;
  email: string;
  quantity: number;
  excludedOrderId?: string;
}

/** Call under the event policy lock, which prevents the listing limit changing mid-checkout. */
export async function exceededBuyerLimit(tx: Prisma.TransactionClient, purchase: BuyerPurchase): Promise<number | null> {
  const { eventId, email, quantity, excludedOrderId } = purchase;
  const listing = await tx.eventListing.findUnique({ where: { eventId }, select: { buyerTicketLimit: true } });
  const limit = listing?.buyerTicketLimit;
  if (limit == null) return null;
  if (quantity > limit) return limit;

  // Separate checkout intents for the same buyer must take turns counting and reserving.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array(${eventId}::text, lower(btrim(${email})))::text, 13))::text`;
  const [{ committed }] = await tx.$queryRaw<{ committed: bigint }[]>`
    SELECT COALESCE(SUM(i.quantity), 0)::bigint AS committed
    FROM ticket_orders o JOIN ticket_order_items i ON i."orderId" = o.id
    WHERE o."eventId" = ${eventId} AND lower(btrim(o."buyerEmail")) = lower(btrim(${email}))
      AND o.status IN ('RESERVED', 'PAID') AND o.id IS DISTINCT FROM ${excludedOrderId ?? null}::text`;
  return committed + BigInt(quantity) > BigInt(limit) ? limit : null;
}

export async function assertBuyerLimit(tx: Prisma.TransactionClient, purchase: BuyerPurchase) {
  const limit = await exceededBuyerLimit(tx, purchase);
  if (limit !== null) throw new DomainHttpException('TICKET_BUYER_LIMIT_REACHED', `This event limits each buyer to ${limit} ticket(s)`);
}
