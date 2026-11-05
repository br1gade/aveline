import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';

import { findOrganizations } from './api';
import type { CustomerOrganization } from './types';

export interface CustomersData {
  query: string;
  /** Refused to anyone but Aveline's staff. */
  organizations: Loaded<CustomerOrganization[]>;
}

/**
 * Whether this account is Aveline's staff's, by asking, as docs/API.md says to rather than decode the
 * token (design PD-165). A hint only, for what a page offers: the server still decides every action.
 */
export async function isAvelineStaff(api: ApiClient): Promise<boolean> {
  return (await loaded(findOrganizations(api, null))).kind === 'ready';
}

export async function loadCustomers(api: ApiClient, query: string | null): Promise<CustomersData> {
  return { query: query ?? '', organizations: await loaded(findOrganizations(api, query)) };
}
