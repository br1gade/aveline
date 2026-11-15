import { expectData, type ApiClient } from '@/api/client';

import type { StaffAccount, StaffRole } from './types';

/** Every route needs `staff:manage`, which only an `ADMIN` holds (docs/API.md). */
export async function listStaff(api: ApiClient): Promise<StaffAccount[]> {
  return (await expectData(api.GET('/api/v1/staff'))).items;
}

/** Makes a registered, confirmed account staff, or changes its role: the same call either way. */
export async function grantStaff(
  api: ApiClient,
  grant: { email: string; role: StaffRole },
): Promise<StaffAccount> {
  return expectData(api.POST('/api/v1/staff', { body: grant }));
}

/** Returns a staff account to an ordinary one. */
export async function revokeStaff(api: ApiClient, userId: string): Promise<void> {
  await expectData(api.DELETE('/api/v1/staff/{userId}', { params: { path: { userId } } }));
}
