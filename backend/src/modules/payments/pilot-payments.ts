import { ForbiddenException } from '@nestjs/common';

/** A deployment policy, checked inside every charge flow, not just the client. */
export function assertChargesEnabled(): void {
  if (process.env.PILOT_MODE === 'true') {
    throw new ForbiddenException('Payments are disabled for the free pilot');
  }
}

export function assertAmountMayBeCharged(amountMinor: bigint): void {
  if (amountMinor > 0n) assertChargesEnabled();
}
