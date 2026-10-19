import { MessageStatus, Prisma } from '@prisma/client';
import { WhatsAppOutcome } from './whatsapp-payload';

export type WhatsAppFailureKind = 'CONFIGURATION' | 'TRANSIENT' | 'AMBIGUOUS' | 'UNKNOWN';
interface ReceiptState { outcome: WhatsAppOutcome; occurredAt: Date; errorCode: number | null }
interface MessageState { status: MessageStatus; deliveredAt: Date | null; readAt: Date | null; providerStatusAt: Date | null }
const CONFIGURATION_CODES = new Set([0, 3, 10, 33, 100, 190, 200, 368, 130497, 131005, 131008, 131009, 131021, 131031, 131037, 131042, 131045, 131047, 131051, 131053, 131063, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 133010]);
const TRANSIENT_CODES = new Set([1, 2, 4, 80007, 130429, 131000, 131016, 131048, 131056, 131057, 131064, 133004]);
const AMBIGUOUS_CODES = new Set([130403, 130472, 131026, 131049, 131050]);

export function classifyWhatsAppCode(code: number | null): WhatsAppFailureKind {
  if (code === null) return 'UNKNOWN';
  if (CONFIGURATION_CODES.has(code)) return 'CONFIGURATION';
  if (TRANSIENT_CODES.has(code)) return 'TRANSIENT';
  if (AMBIGUOUS_CODES.has(code)) return 'AMBIGUOUS';
  return 'UNKNOWN';
}

export function deriveWhatsAppUpdate(message: MessageState, receipt: ReceiptState): Prisma.MessageUpdateInput {
  if (receipt.outcome === 'DELIVERED' || receipt.outcome === 'READ') return confirmDelivery(message, receipt);
  if (message.deliveredAt || message.readAt || message.status === 'DELIVERED') return {};
  if (message.providerStatusAt && message.providerStatusAt > receipt.occurredAt) return {};
  if (receipt.outcome === 'SENT') {
    if (message.status === 'FAILED') return {};
    return { status: 'SENT', providerStatusAt: receipt.occurredAt };
  }
  const kind = classifyWhatsAppCode(receipt.errorCode);
  return { status: 'FAILED', providerStatusAt: receipt.occurredAt, deliveryFailedAt: receipt.occurredAt, deliveryErrorCode: receipt.errorCode, deliveryFailureKind: kind, failureReason: `WhatsApp delivery failed (${kind})` };
}

function confirmDelivery(message: MessageState, receipt: ReceiptState): Prisma.MessageUpdateInput {
  const readAt = receipt.outcome === 'READ' ? earlier(message.readAt, receipt.occurredAt) : message.readAt;
  return {
    status: 'DELIVERED', deliveredAt: earlier(message.deliveredAt, receipt.occurredAt), readAt,
    providerStatusAt: later(message.providerStatusAt, receipt.occurredAt), failureReason: null,
    deliveryFailedAt: null, deliveryErrorCode: null, deliveryFailureKind: null,
  };
}
function earlier(existing: Date | null, incoming: Date): Date { return existing && existing < incoming ? existing : incoming; }
function later(existing: Date | null, incoming: Date): Date { return existing && existing > incoming ? existing : incoming; }
