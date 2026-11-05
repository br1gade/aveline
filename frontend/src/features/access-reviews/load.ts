import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';

import { listReviews } from './api';
import type { ReviewsPage } from './types';

export interface AccessReviewsData {
  /** Refused to anyone but Aveline's administrators. */
  reviews: Loaded<ReviewsPage>;
}

export async function loadAccessReviews(api: ApiClient): Promise<AccessReviewsData> {
  return { reviews: await loaded(listReviews(api)) };
}
