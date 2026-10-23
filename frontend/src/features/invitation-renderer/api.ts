import { expectData, type ApiClient } from '@/api/client';

import type { Invitation } from './types';

export interface InvitationRequest {
  slug: string;
  /** The personal link's token. A credential: never logged (root CLAUDE.md §3). */
  guestToken?: string | undefined;
  /** The generic link only: the language the guest chose. Personal links use the guest's (F16). */
  locale?: string | undefined;
}

/** `GET /invitations/:slug` or `…/g/:guestToken` (docs/API.md §4). */
export function fetchInvitation(api: ApiClient, request: InvitationRequest): Promise<Invitation> {
  const { slug, guestToken, locale } = request;
  if (guestToken) {
    return expectData<Invitation>(
      api.GET('/api/v1/invitations/{slug}/g/{guestToken}', {
        params: { path: { slug, guestToken } },
      }),
    );
  }
  return expectData<Invitation>(
    api.GET('/api/v1/invitations/{slug}', {
      // The schema marks `locale` required though the API treats it as optional (FR-17); an
      // empty value means "none" to the backend.
      params: { path: { slug }, query: { locale: locale ?? '' } },
    }),
  );
}
