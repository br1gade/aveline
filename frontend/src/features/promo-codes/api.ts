import { expectData, type ApiClient } from '@/api/client';

import type { components } from '@/api/schema';

import { readPromoCodes } from './read';

import type { PromoCode } from './types';

type Schemas = components['schemas'];

/** `billing:read`, which only the organization's owner holds (docs/API.md §6). Unpaged. */
export async function listPromoCodes(api: ApiClient): Promise<PromoCode[]> {
  const wire = await expectData(api.GET('/api/v1/promo-codes'));
  return readPromoCodes(wire);
}

export async function createPromoCode(
  api: ApiClient,
  body: Schemas['CreatePromoCodeDto'],
): Promise<void> {
  await expectData(api.POST('/api/v1/promo-codes', { body }));
}

/** The limit, the end, or whether it can be used: what kind and value can't change. */
export async function updatePromoCode(
  api: ApiClient,
  codeId: string,
  body: Schemas['UpdatePromoCodeDto'],
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/promo-codes/{codeId}', { params: { path: { codeId } }, body }),
  );
}

/** Stops the code. Nothing is ever deleted: a refund is worked out from what an order was charged. */
export async function stopPromoCode(api: ApiClient, codeId: string): Promise<void> {
  await expectData(api.DELETE('/api/v1/promo-codes/{codeId}', { params: { path: { codeId } } }));
}
