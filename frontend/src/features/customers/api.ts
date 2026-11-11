import { expectData, type ApiClient } from '@/api/client';
import { readEveryPage, type EveryPage } from '@/api/every-page';
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
  const { organization, isExisting, relationship } = await expectData(
    api.POST('/api/v1/concierge/organizations', { body }),
  );
  return {
    organization: { id: organization.id, name: organization.name },
    isExisting,
    relationship: relationship ?? null,
  };
}

/** How far the matches are read: 50 a page, as the backend caps it, and at most ten pages. */
const CHOICES_PAGES = 10;

/**
 * The organizations a customer's address owns or is invited to own, when it is more than one
 * (FR-130): every page, by `nextCursor`, saying when the limit cut them short. Another role there
 * doesn't count.
 */
export async function customerChoices(
  api: ApiClient,
  ownerEmail: string,
): Promise<EveryPage<CustomerChoice>> {
  const read = await readEveryPage(
    (cursor) =>
      expectData(
        api.POST('/api/v1/concierge/organizations/resolve-customer', {
          body: { ownerEmail, ...(cursor ? { cursor } : {}) },
        }),
      ),
    CHOICES_PAGES,
  );
  return {
    items: read.items.map(({ id, name, relationship }) => ({ id, name, relationship })),
    isComplete: read.isComplete,
  };
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
