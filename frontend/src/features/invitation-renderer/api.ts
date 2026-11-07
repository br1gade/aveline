import { expectData, type ApiClient } from '@/api/client';

import type { Invitation } from './types';

export interface InvitationRequest {
  slug: string;
  /** The personal link's token. A credential: never logged (root CLAUDE.md §3). */
  guestToken?: string | undefined;
  /**
   * The language the guest chose with the switcher. Without it, a personal link is in the guest's
   * own language and the generic one in the event's default.
   */
  locale?: string | undefined;
}

/** `GET /invitations/:slug` or `…/g/:guestToken` (docs/API.md §4). */
export function fetchInvitation(api: ApiClient, request: InvitationRequest): Promise<Invitation> {
  const { slug, guestToken } = request;
  const query = request.locale ? { locale: request.locale } : {};
  if (guestToken) {
    return expectData<Invitation>(
      api.GET('/api/v1/invitations/{slug}/g/{guestToken}', {
        params: { path: { slug, guestToken }, query },
      }),
    );
  }
  return expectData<Invitation>(
    api.GET('/api/v1/invitations/{slug}', { params: { path: { slug }, query } }),
  );
}
