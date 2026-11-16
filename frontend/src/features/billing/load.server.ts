import { fetchPaymentOptions, type PaymentOptions } from '@/api/payment-options';
import { createVisitorApi } from '@/api/visitor.server';

import { listPlans } from './api';
import type { Plan } from './types';

/**
 * The public price list, read on the server through the internal API address with no session
 * (docs/API.md §6). A failure goes to the error boundary with its request id, a 429 too. Each
 * visitor counts against their own address, under the guest-page allowance (FR-147). Whether a
 * paid plan can be bought is said with the prices, before anyone chooses (FR-109).
 */
export async function loadPricing(
  incoming: Request,
): Promise<{ plans: Plan[]; payment: PaymentOptions }> {
  const api = createVisitorApi(incoming);
  const [plans, payment] = await Promise.all([listPlans(api), fetchPaymentOptions(api)]);
  return { plans, payment };
}
