import { data } from 'react-router';

import {
  InvitationNotFound,
  InvitationPage,
  invitationLanguage,
  invitationMeta,
} from '@/features/invitation-renderer';
import { loadInvitationPage } from '@/features/invitation-renderer/index.server';
import { publicInvitationHeaders } from '@/lib/security/headers';

import type { Route } from './+types/invitation';

/** The generic link: no guest, so no personal card and no form (spec §4). */
export async function loader({ params, request }: Route.LoaderArgs) {
  const locale = new URL(request.url).searchParams.get('locale') ?? undefined;
  const page = await loadInvitationPage({ slug: params.slug, locale });
  return data(page, { status: page.state === 'found' ? 200 : 404 });
}

export function headers() {
  return publicInvitationHeaders();
}

export function meta({ loaderData }: Route.MetaArgs) {
  return invitationMeta(loaderData);
}

export const handle = { pageLanguage: invitationLanguage };

function languageHref(language: string): string {
  return `?locale=${language}`;
}

export default function GenericInvitation({ loaderData }: Route.ComponentProps) {
  if (loaderData.state === 'not-found') {
    return <InvitationNotFound />;
  }
  return <InvitationPage invitation={loaderData.invitation} languageHref={languageHref} />;
}
