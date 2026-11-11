import { isApiError } from '@/api/errors';

/** Each action a vendor page offers every role, so each 403 is worded for it (FR-6). */
export type VendorAction =
  | 'list'
  | 'choices'
  | 'add'
  | 'correct'
  | 'remove'
  | 'bookings'
  | 'book'
  | 'change'
  | 'pause'
  | 'newLink'
  | 'end'
  | 'engageAgain';

/** The form's fields a 400 can name, under the backend's names for them. */
const REFUSED_FIELDS: Readonly<Record<string, string>> = {
  name: 'name',
  category: 'category',
  email: 'email',
  phone: 'phone',
  notes: 'notes',
  vendorId: 'vendorId',
  feeCurrency: 'currency',
  briefScopes: 'scopes',
  feeMinor: 'fee',
  status: 'status',
};

export type VendorRefusal =
  | { kind: 'forbidden'; action: Exclude<VendorAction, 'list'>; isStale?: undefined }
  | { kind: 'noOrganization' | 'chooseOrganization' | 'rateLimited'; isStale?: undefined }
  /** The vendor isn't on this organization's list, or Aveline's, any more (404 on booking it,
   * correcting it or removing it). */
  | { kind: 'vendorGone'; isStale: true }
  /** The booking is no longer on this event. */
  | { kind: 'bookingGone'; isStale: true }
  | { kind: 'fields'; fields: string[]; isStale?: undefined }
  | { kind: 'noAnswer'; requestId?: string | undefined; isStale?: undefined }
  | { kind: 'other'; sentence: string; requestId?: string | undefined; isStale?: undefined };

/** The form fields a 400 names: its details, the backend's `field: …` prefix, or class-validator's "field must…". */
function refusedFields(error: {
  details: ReadonlyArray<{ field: string | null }>;
  fieldErrors: Readonly<Record<string, unknown>>;
  messages: readonly string[];
}): string[] {
  const named = [
    ...error.details.flatMap((detail) => (detail.field ? [detail.field] : [])),
    ...Object.keys(error.fieldErrors),
    ...error.messages.flatMap((said) => /^(\w+) must\b/.exec(said)?.[1] ?? []),
  ];
  return [...new Set(named.flatMap((field) => REFUSED_FIELDS[field] ?? []))];
}

/** The organization routes' own codes, which say more than their status (docs/API.md §1). */
const ORGANIZATION_CODES: Readonly<Record<string, VendorRefusal>> = {
  ORGANIZATION_ACCESS_DENIED: { kind: 'noOrganization' },
  ORGANIZATION_SELECTION_REQUIRED: { kind: 'chooseOrganization' },
};

/** The actions whose 404 means the vendor is gone; on any other, the booking is. */
const ON_THE_VENDOR: ReadonlySet<VendorAction> = new Set(['book', 'correct', 'remove']);

/** A refusal its status alone says, for the action pressed; `null` when the status doesn't. */
function byStatus(status: number, action: VendorAction): VendorRefusal | null {
  // Every organization role holds `vendor:read`, and the list's optional organization scope
  // resolves none for an account without a membership, which the guard then refuses as a plain
  // 403 (`auth.guard.ts`): so a 403 on the organization's list means no organization. The event's
  // choices are read with `vendor:read` on the event, so a 403 there is the role's (FR-103).
  if (status === 403)
    return action === 'list' ? { kind: 'noOrganization' } : { kind: 'forbidden', action };
  if (status === 429) return { kind: 'rateLimited' };
  if (status !== 404) return null;
  return ON_THE_VENDOR.has(action)
    ? { kind: 'vendorGone', isStale: true }
    : { kind: 'bookingGone', isStale: true };
}

/**
 * Every refusal here is told apart by its status and code, so no sentence is matched. The vendor
 * routes judge `vendor:read` and `vendor:write` by the organization's role or the event's; the
 * organization's list has no event, so someone on an event only is refused it, and books from the
 * event's own choices (FR-103).
 */
export function vendorRefusalOf(error: unknown, action: VendorAction): VendorRefusal {
  if (!isApiError(error)) throw error;
  const { status, messages, requestId, code } = error;
  if (status === 0 || status >= 500) return { kind: 'noAnswer', requestId };
  const known = (code ? ORGANIZATION_CODES[code] : undefined) ?? byStatus(status, action);
  if (known) return known;
  const fields = status === 400 ? refusedFields(error) : [];
  if (fields.length > 0) return { kind: 'fields', fields };
  return { kind: 'other', sentence: messages.join(' '), requestId };
}
