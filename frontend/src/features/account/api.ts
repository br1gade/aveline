import { expectData, type ApiClient, type PublicApiClient } from '@/api/client';
import type { components } from '@/api/schema';

import { listOwnOrganizations, settleChoice } from './organizations';
import type { Account, InviteAccepted, InviteKind, Organization, OwnOrganization } from './types';

type Schemas = components['schemas'];

/** Answers 202 whether or not the address had an account, and never signs in (D16). */
export async function register(api: PublicApiClient, body: Schemas['RegisterDto']): Promise<void> {
  await expectData(api.POST('/api/v1/auth/register', { body }));
}

/** Always reports that a link was sent, for any address (docs/API.md §2). */
export async function requestPasswordReset(api: PublicApiClient, email: string): Promise<void> {
  await expectData(api.POST('/api/v1/auth/password-reset', { body: { email } }));
}

/** Ends every session of the account, this one included. */
export async function confirmPasswordReset(
  api: PublicApiClient,
  body: Schemas['ConfirmPasswordResetDto'],
): Promise<void> {
  await expectData(api.POST('/api/v1/auth/password-reset/confirm', { body }));
}

/** Who is signed in: identity, platform role and whether the address is confirmed (FR-5). */
export function readAccount(api: ApiClient): Promise<Account> {
  return expectData(api.GET('/api/v1/me'));
}

/** Sends a new confirmation link to the signed-in account; earlier links stop working (§2). */
export async function requestEmailConfirmation(api: ApiClient): Promise<void> {
  await expectData(api.POST('/api/v1/auth/verify-email'));
}

export async function confirmEmail(api: PublicApiClient, token: string): Promise<void> {
  await expectData(api.POST('/api/v1/auth/verify-email/confirm', { body: { token } }));
}

export function acceptInvite(
  api: PublicApiClient,
  kind: InviteKind,
  body: Schemas['AcceptInviteDto'],
): Promise<InviteAccepted> {
  return kind === 'organization'
    ? expectData(api.POST('/api/v1/invites/accept', { body }))
    : expectData(api.POST('/api/v1/event-invites/accept', { body }));
}

/** The same key and body answer the organization already made (docs/API.md §6), so a retry is safe. */
export function createOrganization(
  api: ApiClient,
  body: Schemas['CreateOrganizationDto'],
  idempotencyKey: string,
): Promise<Organization> {
  return expectData(
    api.POST('/api/v1/organizations', {
      body,
      params: { header: { 'idempotency-key': idempotencyKey } },
    }),
  );
}

/**
 * The organization this tab works in, or null when it has none or hasn't chosen: read again each
 * time, as a new one may just have been made.
 */
export async function ownOrganization(api: ApiClient): Promise<OwnOrganization | null> {
  return settleChoice(await listOwnOrganizations(api)).current;
}
