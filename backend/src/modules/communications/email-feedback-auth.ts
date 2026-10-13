import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyEmailFeedback(body: Buffer | undefined, headers: { timestamp?: string; signature?: string }, secret: string | undefined, now = Date.now()): void {
  if (!secret) throw new ServiceUnavailableException('Email feedback is not configured');
  if (!body || body.length > 16384) throw new BadRequestException('Feedback body must be available and at most 16 KiB');
  const { timestamp, signature } = headers;
  const verifiedTimestamp = requireCurrentTimestamp(timestamp, now);
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) throw new UnauthorizedException('Invalid feedback signature');
  const expected = createHmac('sha256', secret).update(`${verifiedTimestamp}.`).update(body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new UnauthorizedException('Invalid feedback signature');
}

function requireCurrentTimestamp(timestamp: string | undefined, now: number): string {
  if (!timestamp || !/^\d{10}$/.test(timestamp) || Math.abs(now - Number(timestamp) * 1000) > 300000) {
    throw new UnauthorizedException('Invalid feedback timestamp');
  }
  return timestamp;
}
