import type { Invitation } from '@/features/invitation-renderer';

/**
 * What the section page and its draft preview's frame say to each other (design PD-153): the
 * frame says it is ready, and the page sends the page to draw. Both are the app on its own origin;
 * anything from another origin, another window or of another shape is ignored.
 */
const TYPE = 'aveline:draft-preview:1';

export type DraftMessage = { kind: 'ready' } | { kind: 'draft'; invitation: Invitation };

export const READY_MESSAGE = { type: TYPE, kind: 'ready' } as const;

export function draftMessage(invitation: Invitation) {
  return { type: TYPE, kind: 'draft', invitation } as const;
}

function isInvitation(value: unknown): value is Invitation {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { blocks?: unknown }).blocks)
  );
}

export function readDraftMessage(
  event: MessageEvent,
  expected: { origin: string; source: MessageEventSource | null },
): DraftMessage | null {
  if (event.origin !== expected.origin || event.source !== expected.source) return null;
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null) return null;
  const { type, kind, invitation } = data as Record<string, unknown>;
  if (type !== TYPE) return null;
  if (kind === 'ready') return { kind };
  return kind === 'draft' && isInvitation(invitation) ? { kind, invitation } : null;
}
