import { createHmac, timingSafeEqual } from 'node:crypto';
import { MessageChannel } from '@prisma/client';
import { jwtSecret } from '../../infra/auth/jwt-secret';

/**
 * A host's mail to their guests, which a guest may stop. Account mail and
 * anything the reader asked for — a ticket, a reply's confirmation — are not:
 * stopping them would cut someone off from what they need.
 */
const UNSUBSCRIBABLE_TEMPLATES: ReadonlySet<string> = new Set(['invitation.send', 'rsvp.reminder', 'event.details-changed', 'thankyou.send']);

interface QueuedMessage {
  id: string;
  channel: MessageChannel;
  templateKey?: string | null;
  organizationId: string | null;
}

/**
 * The one-click unsubscribe link for a message, or none. It names the
 * message and carries a signature, so it is a capability: redacted from logs
 * like the others (`redact-url.ts`).
 */
export function unsubscribeUrlFor(message: QueuedMessage, appUrl: string, secret: string): string | undefined {
  if (message.channel !== MessageChannel.EMAIL || !message.organizationId) return undefined;
  if (!UNSUBSCRIBABLE_TEMPLATES.has(message.templateKey ?? '')) return undefined;
  return `${appUrl}/api/v1/email-unsubscribe/${encodeURIComponent(message.id)}/${signatureFor(message.id, secret)}`;
}

export function isGenuineUnsubscribe(messageId: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(signatureFor(messageId, secret));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The signing key: the token secret, separated by the domain string below. */
export const unsubscribeSecret = (env: NodeJS.ProcessEnv = process.env) => jwtSecret(env.JWT_SECRET, env.NODE_ENV);

/** Domain-separated, so the same key never signs two kinds of thing alike. */
function signatureFor(messageId: string, secret: string): string {
  return createHmac('sha256', secret).update(`email-unsubscribe:${messageId}`).digest('base64url');
}
