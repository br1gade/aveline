import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { DesignPreview, loadDesignPreview, previewRequestOf } from '@/features/invitation-design';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/design-preview';

/** The saved design as guests would see it, through the backend's preview (docs/API.md §6). */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadDesignPreview(api, params.eventId, previewRequestOf(new URL(request.url)));
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('designPreview', languageOfMatches(matches));
}

export default function DesignPreviewRoute({ loaderData }: Route.ComponentProps) {
  return <DesignPreview data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <main className="mx-auto flex w-full max-w-[56rem] flex-col gap-6 px-4 py-8 sm:px-8">
      <EventUnavailable error={error} />
    </main>
  );
}
