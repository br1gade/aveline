import {
  KNOWN_CHANNELS,
  KNOWN_REASONS,
  type Channel,
  type Reason,
  type Suppression,
  type SuppressionWire,
} from './types';

/** The backend's mark for an address kept only as a one-way hash (docs/API.md §6). */
const ERASED_ADDRESS = '[erased]';

function reasonOf(reason: string): Reason {
  return KNOWN_REASONS.find((known) => known === reason) ?? 'OTHER';
}

function channelOf(channel: string): Channel {
  return KNOWN_CHANNELS.find((known) => known === channel) ?? 'OTHER';
}

/** Newest first, as the API lists them; a reason or channel new since is read as "other". */
export function readSuppressions(wire: readonly SuppressionWire[]): Suppression[] {
  return wire.map((entry) => ({
    id: entry.id,
    channel: channelOf(entry.channel),
    address: entry.address,
    isErasedAddress: entry.address === ERASED_ADDRESS,
    reason: reasonOf(entry.reason),
    isGlobal: entry.scope === 'GLOBAL',
    createdAt: entry.createdAt,
  }));
}
