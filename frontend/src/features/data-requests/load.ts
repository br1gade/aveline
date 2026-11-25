import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';
import type { CursorPage } from '@/ui/app-form';

import { listRequests, type RequestQuery } from './api';
import type { DataRequest } from './types';

export const TABS = ['open', 'completed', 'rejected'] as const;
export type RequestTab = (typeof TABS)[number];

const TAB_QUERIES: Readonly<Record<RequestTab, RequestQuery>> = {
  open: { queue: 'OPEN' },
  completed: { queue: 'CLOSED', status: 'COMPLETED' },
  rejected: { queue: 'CLOSED', status: 'REJECTED' },
};

export interface DataRequestsData {
  tab: RequestTab;
  /** The tab's first page; the rest is read on request. */
  requests: Loaded<CursorPage<DataRequest>>;
  now: number;
}

function tabOf(value: string | null): RequestTab {
  return TABS.find((tab) => tab === value) ?? 'open';
}

/** A page of the tab, in the backend's order (FR-127). */
export function readTab(api: ApiClient, tab: RequestTab, cursor?: string) {
  return listRequests(api, TAB_QUERIES[tab], cursor);
}

/** A deadline queue: open ones soonest due first, closed ones newest first. */
export async function loadDataRequests(
  api: ApiClient,
  value: string | null,
  now = Date.now(),
): Promise<DataRequestsData> {
  const tab = tabOf(value);
  return { tab, requests: await loaded(readTab(api, tab)), now };
}
