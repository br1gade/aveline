/**
 * Who must not be contacted (docs/API.md §6, "Suppression"). Interim until FR-1: written from
 * `suppression.service.ts`. The list is the organization's, not an event's.
 */

/** The channels a host can name an address on: Telegram and push take ids a host never sees. */
export const HOST_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP'] as const;
export type HostChannel = (typeof HOST_CHANNELS)[number];

export const KNOWN_REASONS = [
  'UNSUBSCRIBED',
  'HARD_BOUNCE',
  'COMPLAINT',
  'MANUAL',
  'ERASED',
] as const;
export type Reason = (typeof KNOWN_REASONS)[number] | 'OTHER';

export const KNOWN_CHANNELS = ['EMAIL', 'SMS', 'TELEGRAM', 'WHATSAPP', 'PUSH'] as const;
export type Channel = (typeof KNOWN_CHANNELS)[number] | 'OTHER';

export interface SuppressionWire {
  id: string;
  channel: string;
  address: string;
  reason: string;
  scope: string;
  notes?: string | null;
  createdAt: string;
}

export interface Suppression {
  id: string;
  channel: Channel;
  /** `[erased]` when only a one-way hash is kept and no current guest has it. */
  address: string;
  isErasedAddress: boolean;
  reason: Reason;
  /** Platform-wide: a bounce or a complaint, which no customer may lift. */
  isGlobal: boolean;
  createdAt: string;
}
