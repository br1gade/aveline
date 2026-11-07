/**
 * Our words for a write in an event's activity (design PD-158). The trail gives a route's pattern,
 * and an action name made from it, both in English (FR-123), so a row says which part of the event
 * was touched and how, and no more than that: the trail itself holds nothing of what changed. Each
 * part the backend writes to is pinned by a test that reads its controllers. Writes that name the
 * invitation by its slug are on the trail too: publishing, sending, the design.
 */
const AREAS = [
  'archive',
  'attendance-policy',
  'export-snapshots',
  'exports',
  'gallery',
  'guests',
  'households',
  'invitation',
  'listing',
  'media',
  'seating',
  'seats',
  'settings',
  'tables',
  'team',
  'ticket-orders',
  'ticket-types',
  'tickets',
  'timeline',
  'unarchive',
  'vendors',
  'venues',
] as const;

export type ActivityArea = (typeof AREAS)[number] | 'event';

const KNOWN_AREAS = new Set<string>(AREAS);

/** The part of the event a route's pattern names, or `null` for one with no word here. */
export function areaOf(route: string): ActivityArea | null {
  if (/^\/invitations\/:\w+(?:\/(?!g\/)|$)/.test(route)) return 'invitation';
  const match = /^\/events\/:\w+(?:\/([^/:]+))?(?:\/|$)/.exec(route);
  if (!match) return null;
  const segment = match[1];
  if (!segment) return 'event';
  return KNOWN_AREAS.has(segment) ? (segment as ActivityArea) : null;
}

const CHANGES = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export type ActivityChange = 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'OTHER';

export function changeOf(method: string): ActivityChange {
  return CHANGES.has(method) ? (method as ActivityChange) : 'OTHER';
}
