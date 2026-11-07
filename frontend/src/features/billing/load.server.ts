import { createPublicApi } from '@/api/client';
import { readServerEnv } from '@/config/env.server';

import { listPlans } from './api';
import type { Plan } from './types';

/**
 * The public price list, read on the server through the internal API address with no session
 * (docs/API.md §6). A failure goes to the error boundary with its request id. Every visitor counts
 * against one address (FR-73).
 */
export async function loadPricing(): Promise<{ plans: Plan[] }> {
  return { plans: await listPlans(createPublicApi(readServerEnv().API_INTERNAL_URL)) };
}
