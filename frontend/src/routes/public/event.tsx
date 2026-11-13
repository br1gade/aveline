import '@/locales/public';
import { data } from 'react-router';

import { readPublicEnv } from '@/config/env';
import {
  EventNotFound,
  EventPage,
  publicEventLanguage,
  publicEventMeta,
} from '@/features/public-event';
import { loadPublicEvent } from '@/features/public-event/index.server';
import { publicEventHeaders } from '@/lib/security/headers';

import type { Route } from './+types/event';

/** A public event's announcement, at the address its `metadata.canonicalPath` names. */
export async function loader({ params, request }: Route.LoaderArgs) {
  const locale = new URL(request.url).searchParams.get('locale') ?? undefined;
  const page = await loadPublicEvent({ slug: params.slug, locale }, request);
  return data(page, { status: page.state === 'found' ? 200 : 404 });
}

export function headers() {
  return publicEventHeaders();
}

export function meta({ loaderData }: Route.MetaArgs) {
  const event = loaderData?.state === 'found' ? loaderData.event : undefined;
  return publicEventMeta(event, readPublicEnv().VITE_PUBLIC_ORIGIN);
}

export const handle = { pageLanguage: publicEventLanguage };

function languageHref(language: string): string {
  return `?locale=${language}`;
}

export default function PublicEvent({ loaderData }: Route.ComponentProps) {
  if (loaderData.state === 'not-found') {
    return <EventNotFound />;
  }
  return (
    <EventPage
      event={loaderData.event}
      isSalesClosed={loaderData.isSalesClosed}
      languageHref={languageHref}
    />
  );
}
