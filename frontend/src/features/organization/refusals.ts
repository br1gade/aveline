import { isApiError } from '@/api/errors';
import { isOrganizationRefusal } from '@/api/session';

/**
 * Why something here was refused. Two refusals have codes of their own; the rest are English
 * sentences under one code a status, so **a temporary stand-in** recognises each by its exact words,
 * under a test that reads the source, and anything else is shown as it came (design PD-159, FR-28).
 */
type StaleKind = 'changed' | 'handover' | 'memberGone' | 'alreadyMember' | 'noInvite';

export type OrganizationRefusal =
  | { kind: StaleKind; isStale: true }
  | {
      kind: 'forbidden' | 'rateLimited' | 'onlyOwner' | 'emailRefused' | 'nameRefused';
      isStale?: undefined;
    }
  | { kind: 'chooseOrganization' | 'noOrganization'; isStale?: undefined }
  | { kind: 'noAnswer'; requestId?: string | undefined; isStale?: undefined }
  | { kind: 'other'; sentence: string; requestId?: string | undefined; isStale?: undefined };

export const SENTENCES: ReadonlyArray<readonly [string, StaleKind | 'onlyOwner']> = [
  ['That person is already a member', 'alreadyMember'],
  ['No pending invitation for that address', 'noInvite'],
  ['No active member in this organization', 'memberGone'],
  ['No such member', 'memberGone'],
  ['Only a current owner may request closure review', 'onlyOwner'],
];

const CODES: Readonly<Record<string, StaleKind>> = {
  REVISION_CHANGED: 'changed',
  OWNER_HANDOVER_REQUIRED: 'handover',
};

function bySentence(messages: readonly string[]): OrganizationRefusal | null {
  const known = SENTENCES.find(([words]) => messages.includes(words));
  if (!known) return null;
  return known[1] === 'onlyOwner' ? { kind: 'onlyOwner' } : { kind: known[1], isStale: true };
}

/** class-validator starts with the property (FR-20). */
function byField(messages: readonly string[]): OrganizationRefusal | null {
  if (messages.some((said) => /^email\b/.test(said))) return { kind: 'emailRefused' };
  if (messages.some((said) => /^name\b/.test(said))) return { kind: 'nameRefused' };
  return null;
}

function byCode(code: string | undefined): OrganizationRefusal | null {
  const stale = code ? CODES[code] : undefined;
  if (stale) return { kind: stale, isStale: true };
  if (isOrganizationRefusal(code)) return { kind: 'chooseOrganization' };
  return code === 'ORGANIZATION_ACCESS_DENIED' ? { kind: 'noOrganization' } : null;
}

export function refusalOf(error: unknown): OrganizationRefusal {
  if (!isApiError(error)) throw error;
  const { status, code, messages, requestId } = error;
  if (status === 0 || status >= 500) return { kind: 'noAnswer', requestId };
  const known = byCode(code) ?? bySentence(messages);
  if (known) return known;
  if (status === 403) return { kind: 'forbidden' };
  if (status === 429) return { kind: 'rateLimited' };
  return byField(messages) ?? { kind: 'other', sentence: messages.join(' '), requestId };
}
