import { createPublicApi } from '@/api/client';
import { isApiError } from '@/api/errors';
import { retryOnConflict } from '@/api/retry';
import { readServerEnv } from '@/config/env.server';
import { createI18n, isLanguage, SOURCE_LANGUAGE } from '@/lib/i18n';

import { fetchInvitation, type InvitationRequest } from './api';
import type { InvitationPageData, PreviewMeta } from './page-data';
import { occasionOf, type Invitation } from './types';

/** "Anna & Davit · Wedding", in the page's language (spec §12). */
export function previewMeta(invitation: Invitation): PreviewMeta {
  const { t } = createI18n(isLanguage(invitation.locale) ? invitation.locale : SOURCE_LANGUAGE);
  const occasion = t(`invitation:occasion.${occasionOf(invitation.event.type)}`);
  return { title: `${invitation.event.hosts} · ${occasion}`, image: invitation.coverUrl };
}

/**
 * Loads an invitation on the server, through the internal API address. A 404 (a wrong link, a
 * draft, one past its retention date, C-22, or past its expiry) becomes the not-found page; a 409
 * (the invitation changed while it was read) is tried again; anything else goes to the error
 * boundary with its request id.
 */
export async function loadInvitationPage(request: InvitationRequest): Promise<InvitationPageData> {
  const api = createPublicApi(readServerEnv().API_INTERNAL_URL);
  try {
    const invitation = await retryOnConflict(() => fetchInvitation(api, request));
    return { state: 'found', invitation, preview: previewMeta(invitation) };
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      return { state: 'not-found' };
    }
    throw error;
  }
}
