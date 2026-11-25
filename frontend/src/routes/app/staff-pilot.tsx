import { appMeta, requireSignedIn } from '@/features/account';
import { languageOfMatches } from '@/lib/i18n';
import { loadPilotStats, PilotStatsPage } from '@/features/pilot-stats';

import type { Route } from './+types/staff-pilot';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadPilotStats(api);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('staffPilot', languageOfMatches(matches));
}

export default function StaffPilot({ loaderData }: Route.ComponentProps) {
  return <PilotStatsPage data={loaderData} />;
}
