import { Outlet } from 'react-router';

import { AppLoading, requireSignedIn } from '@/features/account';
import { revalidateUnlessQueryOnly } from '@/lib/routing';

import type { Route } from './+types/preview-layout';

/**
 * Signed-in pages without the app's frame: the invitation's preview, which needs the whole window,
 * as a guest's phone or screen gives it (design PD-59). The session check is the app layout's.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  await requireSignedIn(request);
  return null;
}
clientLoader.hydrate = true as const;

export const shouldRevalidate = revalidateUnlessQueryOnly;

export function HydrateFallback() {
  return <AppLoading />;
}

export default function PreviewLayout() {
  return <Outlet />;
}
