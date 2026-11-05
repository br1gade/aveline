import { appMeta, requireSignedIn } from '@/features/account';
import { AccessReviewsPage, loadAccessReviews } from '@/features/access-reviews';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/staff-access-reviews';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadAccessReviews(api);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('staffAccessReviews', languageOfMatches(matches));
}

export default function StaffAccessReviews({ loaderData }: Route.ComponentProps) {
  return <AccessReviewsPage data={loaderData} />;
}
