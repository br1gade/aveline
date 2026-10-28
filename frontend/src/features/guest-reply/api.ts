import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';

import { readAcknowledgements, type AcknowledgementsWire } from './acknowledgements';
import type { AcknowledgementsRead, SignatureUpload } from './signatures';
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

/**
 * The current statements, the household's agreements and the signer's drawings (docs/API.md §11).
 * The newest hundred records: a household of at most 21 agreeing to a few statements fits. The
 * schema types `limit` as an object (FR-38), so it is passed through one cast.
 */
export async function fetchAcknowledgements(
  api: ApiClient,
  link: ReplyLink,
): Promise<AcknowledgementsRead> {
  const query = { limit: 100 } as unknown as Record<string, never>;
  const read = await expectData<AcknowledgementsWire>(
    api.GET('/api/v1/invitations/{slug}/g/{guestToken}/acknowledgements', {
      params: { path: link, query },
    }),
  );
  return readAcknowledgements(read);
}

/**
 * A drawn signature, as one multipart field, `file` (PNG, at most 1 MiB). It is QUEUED until the
 * backend has checked it; only a READY one can sign (docs/API.md §11).
 */
export async function uploadSignature(
  api: ApiClient,
  link: ReplyLink,
  drawing: Blob,
): Promise<SignatureUpload> {
  const form = new FormData();
  form.append('file', drawing, 'signature.png');
  const staged = await expectData<{ id: string }>(
    api.POST('/api/v1/invitations/{slug}/g/{guestToken}/signature-uploads', {
      params: { path: link },
      body: {},
      bodySerializer: () => form,
    }),
  );
  return { id: staged.id, status: 'QUEUED' };
}

/** An unused drawing, when the guest draws again; one already signed with is kept (409). */
export async function removeSignatureUpload(
  api: ApiClient,
  link: ReplyLink,
  mediaId: string,
): Promise<void> {
  await expectData(
    api.DELETE('/api/v1/invitations/{slug}/g/{guestToken}/signature-uploads/{mediaId}', {
      params: { path: { ...link, mediaId } },
    }),
  );
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
