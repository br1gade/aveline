import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';

import type { ReplyRecord, SubmitReplyBody, SubmitResult } from './types';

/** A personal link's address. The token is a credential: it goes to the API and nowhere else. */
export interface ReplyLink {
  slug: string;
  guestToken: string;
}

export function fetchReply(api: ApiClient, link: ReplyLink): Promise<ReplyRecord> {
  return expectData<ReplyRecord>(
    api.GET('/api/v1/invitations/{slug}/g/{guestToken}/rsvp', { params: { path: link } }),
  );
}

/**
 * The schema types each answer's value as an empty object (FR-18). The body's real types are
 * checked in SubmitReplyBody; this is the one place they meet the generated ones.
 */
function asGeneratedBody(body: SubmitReplyBody): components['schemas']['SubmitRsvpDto'] {
  return body as unknown as components['schemas']['SubmitRsvpDto'];
}

/** Safe to send again: the server updates rather than duplicates (docs/API.md §4). */
export function submitReply(
  api: ApiClient,
  link: ReplyLink,
  body: SubmitReplyBody,
): Promise<SubmitResult> {
  return expectData<SubmitResult>(
    api.POST('/api/v1/invitations/{slug}/g/{guestToken}/rsvp', {
      params: { path: link },
      body: asGeneratedBody(body),
    }),
  );
}
