import { expectData, type ApiClient } from '@/api/client';
import { isApiError } from '@/api/errors';
import type { components } from '@/api/schema';

import type { InviteAccepted, InviteKind, Organization } from './types';

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

export function createOrganization(
  api: ApiClient,
  body: Schemas['CreateOrganizationDto'],
): Promise<Organization> {
  return expectData<Organization>(api.POST('/api/v1/organizations', { body }));
}

/**
 * The account's organization, or null when it has none. Until `GET /me` exists (FR-5), a 403 here
 * is how "no organization" shows (docs/API.md §6, "Becoming a tenant").
 */
export async function currentOrganization(api: ApiClient): Promise<Organization | null> {
  try {
    return await expectData<Organization>(api.GET('/api/v1/organizations/current'));
  } catch (error) {
    if (isApiError(error) && error.status === 403) {
      return null;
    }
    throw error;
  }
}
