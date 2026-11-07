import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { loadAdoption, TemplateAdoption } from '@/features/invitation-design';
import { languageOfMatches } from '@/lib/i18n';
import { revalidateUnlessQueryOnly } from '@/lib/routing';

import type { Route } from './+types/design-adoption';

/** An authored template's preview: started here, as each read makes a fresh one. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadAdoption(api, params.eventId, params.versionId);
}

/** Another language is another of the preview's pages, not another preview. */
export const shouldRevalidate = revalidateUnlessQueryOnly;

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('designAdoption', languageOfMatches(matches));
}

export default function DesignAdoption({ loaderData }: Route.ComponentProps) {
  return <TemplateAdoption data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <main className="mx-auto flex w-full max-w-[56rem] flex-col gap-6 px-4 py-8 sm:px-8">
      <EventUnavailable error={error} />
    </main>
  );
}
