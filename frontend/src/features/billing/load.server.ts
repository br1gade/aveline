import { createVisitorApi } from '@/api/visitor.server';

import { listPlans } from './api';
import type { Plan } from './types';

/**
 * The public price list, read on the server through the internal API address with no session
 * (docs/API.md §6). A failure goes to the error boundary with its request id, a 429 too. Each
 * visitor counts against their own address, under the guest-page allowance (FR-147).
 */
export async function loadPricing(incoming: Request): Promise<{ plans: Plan[] }> {
  return { plans: await listPlans(createVisitorApi(incoming)) };
}
