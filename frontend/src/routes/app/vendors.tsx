import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { loadVendors, VendorsPage } from '@/features/vendors';
import { languageOfMatches } from '@/lib/i18n';
import { revalidateUnlessQueryOnly } from '@/lib/routing';

import type { Route } from './+types/vendors';

/** The organization's own vendors and Aveline's curated list; the category is the address's. */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadVendors(api);
}

export const shouldRevalidate = revalidateUnlessQueryOnly;

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('vendors', languageOfMatches(matches));
}

export default function Vendors({ loaderData }: Route.ComponentProps) {
  return <VendorsPage data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
