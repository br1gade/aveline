import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';

import { listRequests } from './api';
import type { DataRequest, RequestStatus } from './types';

export const TABS = ['open', 'completed', 'rejected'] as const;
export type RequestTab = (typeof TABS)[number];

const TAB_STATUSES: Readonly<Record<RequestTab, readonly RequestStatus[]>> = {
  open: ['RECEIVED', 'VERIFYING', 'IN_PROGRESS'],
  completed: ['COMPLETED'],
  rejected: ['REJECTED'],
};

export interface DataRequestsData {
  tab: RequestTab;
  requests: Loaded<DataRequest[]>;
  now: number;
}

function tabOf(value: string | null): RequestTab {
  return TABS.find((tab) => tab === value) ?? 'open';
}

async function readTab(api: ApiClient, tab: RequestTab): Promise<DataRequest[]> {
  const lists = await Promise.all(TAB_STATUSES[tab].map((status) => listRequests(api, status)));
  return lists.flat().sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

/** A deadline queue: what is open comes in three reads, merged by what is due soonest. */
export async function loadDataRequests(
  api: ApiClient,
  value: string | null,
  now = Date.now(),
): Promise<DataRequestsData> {
  const tab = tabOf(value);
  return { tab, requests: await loaded(readTab(api, tab)), now };
}
