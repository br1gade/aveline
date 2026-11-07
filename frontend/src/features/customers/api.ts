import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';
import type { EventDetail } from '@/features/events';

import type { CustomerChoice, CustomerOrganization, OpenedAccount } from './types';

type Schemas = components['schemas'];

/** Newest 50, by name; staff only (`concierge:manage`). */
export async function findOrganizations(
  api: ApiClient,
  search: string | null,
): Promise<CustomerOrganization[]> {
  const found = await expectData<CustomerOrganization[]>(
    api.GET('/api/v1/concierge/organizations', {
      params: { query: search ? { search } : {} },
    }),
  );
  return found.map(({ id, name, events, owners, pendingOwnerInvites }) => ({
    id,
    name,
    events,
    owners,
    pendingOwnerInvites,
  }));
}

/**
 * Opens a customer's organization and emails them an owner's invitation, or answers with the one they
 * have. The invitation's development link holds a token, and only what is named here is kept.
 */
export async function openForCustomer(
  api: ApiClient,
  body: Schemas['OpenForCustomerDto'],
): Promise<OpenedAccount> {
  const { organization, isExisting } = await expectData<OpenedAccount>(
    api.POST('/api/v1/concierge/organizations', { body }),
  );
  return { organization: { id: organization.id, name: organization.name }, isExisting };
}

/** The organizations a customer's address already belongs to, when it is more than one. */
export async function customerChoices(
  api: ApiClient,
  ownerEmail: string,
): Promise<CustomerChoice[]> {
  const { items } = await expectData<{ items: CustomerChoice[] }>(
    api.POST('/api/v1/concierge/organizations/resolve-customer', { body: { ownerEmail } }),
  );
  return items.map(({ id, name }) => ({ id, name }));
}

/** An event in a customer's organization, which staff then run through their platform role. */
export function createEventFor(
  api: ApiClient,
  organizationId: string,
  body: Schemas['CreateEventDto'],
): Promise<EventDetail> {
  return expectData<EventDetail>(
    api.POST('/api/v1/concierge/organizations/{organizationId}/events', {
      params: { path: { organizationId } },
      body,
    }),
  );
}
