import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';

import type { InviteAccepted, InviteKind, Organization, OwnOrganization } from './types';

type Schemas = components['schemas'];

/** Answers 202 whether or not the address had an account, and never signs in (D16). */
export async function register(api: ApiClient, body: Schemas['RegisterDto']): Promise<void> {
  await expectData<unknown>(api.POST('/api/v1/auth/register', { body }));
}

/** Always reports that a link was sent, for any address (docs/API.md §2). */
export async function requestPasswordReset(api: ApiClient, email: string): Promise<void> {
  await expectData<unknown>(api.POST('/api/v1/auth/password-reset', { body: { email } }));
}

/** Ends every session of the account, this one included. */
export async function confirmPasswordReset(
  api: ApiClient,
  body: Schemas['ConfirmPasswordResetDto'],
): Promise<void> {
  await expectData<unknown>(api.POST('/api/v1/auth/password-reset/confirm', { body }));
}

export async function confirmEmail(api: ApiClient, token: string): Promise<void> {
  await expectData<unknown>(api.POST('/api/v1/auth/verify-email/confirm', { body: { token } }));
}

export function acceptInvite(
  api: ApiClient,
  kind: InviteKind,
  body: Schemas['AcceptInviteDto'],
): Promise<InviteAccepted> {
  const call =
    kind === 'organization'
      ? api.POST('/api/v1/invites/accept', { body })
      : api.POST('/api/v1/event-invites/accept', { body });
  return expectData<InviteAccepted>(call);
}

/** The same key and body answer the organization already made (docs/API.md §6), so a retry is safe. */
export function createOrganization(
  api: ApiClient,
  body: Schemas['CreateOrganizationDto'],
  idempotencyKey: string,
): Promise<Organization> {
  return expectData<Organization>(
    api.POST('/api/v1/organizations', {
      body,
      params: { header: { 'idempotency-key': idempotencyKey } },
    }),
  );
}

/**
 * The account's organization, or null when it has none. With several, the oldest: only its name is
 * shown, and choosing one waits for the organization selector (ARCHITECTURE §12).
 */
export async function ownOrganization(api: ApiClient): Promise<OwnOrganization | null> {
  const { items } = await expectData<{ items: OwnOrganization[] }>(
    api.GET('/api/v1/me/organizations'),
  );
  const [first] = items;
  return first ? { organizationId: first.organizationId, name: first.name } : null;
}
