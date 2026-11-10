import { expectData, type PublicApiClient } from '@/api/client';

import { readAcknowledgements, type AcknowledgementsWire } from './acknowledgements';
import type { AcknowledgementsRead, SignatureUpload } from './signatures';
import type { ReplyRecord, SubmitReplyBody, SubmitResult } from './types';

/** A personal link's address. The token is a credential: it goes to the API and nowhere else. */
export interface ReplyLink {
  slug: string;
  guestToken: string;
}

export function fetchReply(api: PublicApiClient, link: ReplyLink): Promise<ReplyRecord> {
  return expectData<ReplyRecord>(
    api.GET('/api/v1/invitations/{slug}/g/{guestToken}/rsvp', { params: { path: link } }),
  );
}

/** A drawn agreement's picture, read through the guest's own link and shown from memory. */
export function drawingFile(
  api: PublicApiClient,
  { slug, guestToken }: ReplyLink,
  acknowledgementId: string,
  signal: AbortSignal,
): Promise<Blob> {
  return expectData<Blob>(
    api.GET('/api/v1/invitations/{slug}/g/{guestToken}/acknowledgements/{acknowledgementId}/file', {
      params: { path: { slug, guestToken, acknowledgementId } },
      parseAs: 'blob',
      signal,
    }),
  );
}

/**
 * The current statements, the household's agreements and the signer's drawings (docs/API.md §11).
 * The newest hundred records: a household of at most 21 agreeing to a few statements fits.
 */
export async function fetchAcknowledgements(
  api: PublicApiClient,
  link: ReplyLink,
): Promise<AcknowledgementsRead> {
  const read = await expectData<AcknowledgementsWire>(
    api.GET('/api/v1/invitations/{slug}/g/{guestToken}/acknowledgements', {
      params: { path: link, query: { limit: 100 } },
    }),
  );
  return readAcknowledgements(read);
}

/**
 * A drawn signature, as one multipart field, `file` (PNG, at most 1 MiB). It is QUEUED until the
 * backend has checked it; only a READY one can sign (docs/API.md §11).
 */
export async function uploadSignature(
  api: PublicApiClient,
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
  api: PublicApiClient,
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
  api: PublicApiClient,
  link: ReplyLink,
  body: SubmitReplyBody,
): Promise<SubmitResult> {
  return expectData<SubmitResult>(
    api.POST('/api/v1/invitations/{slug}/g/{guestToken}/rsvp', {
      params: { path: link },
      body,
    }),
  );
}
