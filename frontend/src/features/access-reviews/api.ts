import { expectData, type ApiClient } from '@/api/client';

import type { components } from '@/api/schema';

import { readReview } from './read';

import type { ReviewsPage } from './types';

/** The backend's default page: each review names its organization, so nothing more is read (FR-133). */
export const PAGE_SIZE = 50;

/** Open reviews, oldest first; `ADMIN` only. */
export async function listReviews(api: ApiClient, cursor?: string): Promise<ReviewsPage> {
  const page = await expectData(
    api.GET('/api/v1/admin/organization-access-reviews', {
      params: { query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
    }),
  );
  return { items: page.items.map(readReview), nextCursor: page.nextCursor };
}

export async function resolveReview(
  api: ApiClient,
  reviewId: string,
  body: components['schemas']['ResolveOrganizationReviewDto'],
): Promise<void> {
  await expectData(
    api.POST('/api/v1/admin/organization-access-reviews/{reviewId}/resolve', {
      params: { path: { reviewId } },
      body,
    }),
  );
}
