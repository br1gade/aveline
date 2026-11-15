import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';
import { readAccountOnce } from '@/features/account';

import { listStaff } from './api';
import type { StaffAccount } from './types';

export interface StaffAccountsData {
  /** Refused to anyone but Aveline's administrators. */
  staff: Loaded<StaffAccount[]>;
  /** Whose page this is: their own row is never changed here, as the API refuses it. */
  selfId: string | null;
}

export async function loadStaffAccounts(api: ApiClient): Promise<StaffAccountsData> {
  const [staff, self] = await Promise.all([loaded(listStaff(api)), loaded(readAccountOnce(api))]);
  return { staff, selfId: self.kind === 'ready' ? self.value.id : null };
}
