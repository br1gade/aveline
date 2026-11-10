import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';

import { findOrganizations } from './api';
import type { CustomerOrganization } from './types';

export interface CustomersData {
  query: string;
  /** Refused to anyone but Aveline's staff. */
  organizations: Loaded<CustomerOrganization[]>;
}

export async function loadCustomers(api: ApiClient, query: string | null): Promise<CustomersData> {
  return { query: query ?? '', organizations: await loaded(findOrganizations(api, query)) };
}
