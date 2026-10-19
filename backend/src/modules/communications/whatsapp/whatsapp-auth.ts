import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual, webcrypto } from 'node:crypto';

export const WHATSAPP_BODY_LIMIT = 3 * 1024 * 1024;

export async function verifyWhatsAppSignature(body: Buffer | undefined, signature: string | undefined, secret: string | undefined): Promise<void> {
  if (!secret) throw new ServiceUnavailableException('WhatsApp webhook is not configured');
  if (!body || body.length > WHATSAPP_BODY_LIMIT) throw new BadRequestException('WhatsApp body must be available and at most 3 MiB');
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) throw new UnauthorizedException('Invalid WhatsApp signature');
  // Web Crypto moves hashing off the event loop, including Meta's largest batches.
  const key = await webcrypto.subtle.importKey('raw', Buffer.from(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = Buffer.from(await webcrypto.subtle.sign('HMAC', key, Uint8Array.from(body)));
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) throw new UnauthorizedException('Invalid WhatsApp signature');
}

export function verifyWhatsAppChallenge(query: Record<string, unknown>, secret: string | undefined): string {
  if (!secret) throw new ServiceUnavailableException('WhatsApp verification is not configured');
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (query['hub.mode'] !== 'subscribe' || typeof token !== 'string' || token.length > 256) throw new UnauthorizedException('Invalid WhatsApp verification');
  const expected = Buffer.from(secret);
  const actual = Buffer.from(token);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new UnauthorizedException('Invalid WhatsApp verification');
  if (typeof challenge !== 'string' || challenge.length === 0 || challenge.length > 256) throw new BadRequestException('Invalid hub.challenge');
  return challenge;
}
