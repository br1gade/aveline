import { useEffect, useMemo, useState } from 'react';

import type { ApiClient } from '@/api/client';
import type { Invitation } from '@/features/invitation-renderer';

import {
  fetchAcknowledgements,
  removeSignatureUpload,
  uploadSignature,
  type ReplyLink,
} from '../api';
import { fullName } from '../form-model';
import { pollUpload, waitFor } from '../signature-upload';
import {
  coveredGuests,
  currentStatements,
  type AcknowledgementsRead,
  type SignatureContext,
} from '../signatures';
import type { ReplyRecord } from '../types';
import type { SigningActions } from './form-context';

/**
 * The household's agreements, read in the browser when the invitation has a statement, and again
 * after each reload or send (`refresh`). While it loads, or if it fails, everyone coming is asked
 * to agree: the server keeps one record per person and wording, so asking again records nothing
 * twice.
 */
function useAcknowledgements(
  api: ApiClient,
  link: ReplyLink,
  invitation: Invitation,
  refresh: number,
) {
  const [read, setRead] = useState<AcknowledgementsRead | null>(null);
  const hasStatements = invitation.rsvpQuestions.some((question) => question.type === 'SIGNATURE');
  const { slug, guestToken } = link;
  useEffect(() => {
    if (!hasStatements) return;
    let isCurrent = true;
    fetchAcknowledgements(api, { slug, guestToken }).then(
      (fresh) => {
        if (isCurrent) setRead(fresh);
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [api, slug, guestToken, hasStatements, refresh]);
  return read;
}

/** The statements to agree to, who already has, and who signs; `null` when there is none. */
export function useSignatureContext(
  api: ApiClient,
  props: { link: ReplyLink; invitation: Invitation; record: ReplyRecord; refresh: number },
): SignatureContext | null {
  const { link, invitation, record, refresh } = props;
  const read = useAcknowledgements(api, link, invitation, refresh);
  return useMemo(() => {
    const statements = currentStatements(invitation, read);
    if (statements.length === 0) return null;
    return {
      statements,
      covered: coveredGuests(statements, read?.records ?? []),
      signer: { guestId: record.guest.id, name: fullName(record.guest) },
    };
  }, [invitation, read, record.guest]);
}

/** Uploading a drawing and waiting for its check, then forgetting one the guest replaced. */
export function useSigning(api: ApiClient, link: ReplyLink): SigningActions {
  const { slug, guestToken } = link;
  return useMemo(() => {
    const at = { slug, guestToken };
    return {
      async upload(drawing, signal, onStaged) {
        const staged = await uploadSignature(api, at, drawing);
        onStaged();
        const outcome = await pollUpload({
          read: async () =>
            (await fetchAcknowledgements(api, at)).uploads.find((upload) => upload.id === staged.id)
              ?.status,
          wait: waitFor,
          signal,
        });
        return outcome === 'READY' ? staged.id : null;
      },
      remove(assetId) {
        removeSignatureUpload(api, at, assetId).catch(() => undefined);
      },
    };
  }, [api, slug, guestToken]);
}
