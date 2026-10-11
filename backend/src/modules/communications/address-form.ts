import { MessageChannel } from '@prisma/client';
import { createHash } from 'node:crypto';
import { normalizeEmailAddress } from '../../common/address';

const FINGERPRINT_PREFIX = 'sha256:';

/**
 * Email addresses are case-insensitive in practice, so they are stored and
 * matched lower-cased — otherwise `Ani@x.am` would slip past a suppression
 * recorded for `ani@x.am`. Phone numbers and chat handles are left as given,
 * because normalising them correctly needs a region and guessing wrong would
 * suppress the wrong person.
 */
export function normalizeAddress(channel: MessageChannel, address: string): string {
  return channel === MessageChannel.EMAIL ? normalizeEmailAddress(address) : address.trim();
}

/**
 * The form a suppression keeps once its owner's data is erased (decided 10
 * October 2026, D15).
 *
 * Deleting the row would let a person who complained be written to again the
 * moment a host re-adds them; keeping the address would keep data we were
 * asked to drop. A one-way hash is both: an address someone already has can
 * be checked against it, and the row alone gives nothing back. Unsalted on
 * purpose — the only question it answers is "is this the address?", and
 * whoever asks it already holds the address.
 */
export function addressFingerprint(channel: MessageChannel, address: string): string {
  const digest = createHash('sha256').update(normalizeAddress(channel, address)).digest('hex');
  return `${FINGERPRINT_PREFIX}${digest}`;
}

export function isFingerprint(storedAddress: string): boolean {
  return storedAddress.startsWith(FINGERPRINT_PREFIX);
}

/** Both ways an address may be stored: as itself, or hashed after an erasure. */
export function storedForms(channel: MessageChannel, address: string): string[] {
  return [normalizeAddress(channel, address), addressFingerprint(channel, address)];
}
