import { useEffect, useMemo, useState } from 'react';

import { createPublicApi } from '@/api/client';
import { readPublicEnv } from '@/config/env';
import {
  comingPeople,
  coveredGuests,
  currentStatements,
  fetchAcknowledgements,
  useSigning,
  type AcknowledgementsRead,
  type ReplyLink,
  type ReplyRecord,
} from '@/features/guest-reply';
import type { Invitation } from '@/features/invitation-renderer';

import { doorAgreements } from '../door';

/**
 * The household's agreements, read in the browser, and what is still to agree before the door.
 * Nothing is asked until they are read: unlike the reply form, this section only exists to agree,
 * so asking everyone again while it loads would mislead. `version` rises after each agreement, so
 * the reply form reads them again too.
 */
export function useDoorAgreements(
  invitation: Invitation,
  link: ReplyLink,
  record: ReplyRecord | null,
) {
  const { locale } = invitation;
  const api = useMemo(
    () => createPublicApi(readPublicEnv().VITE_API_BASE_URL, { getLanguage: () => locale }),
    [locale],
  );
  const signing = useSigning(api, link);
  const [read, setRead] = useState<AcknowledgementsRead | null>(null);
  const [version, setVersion] = useState(0);
  const hasStatements = invitation.rsvpQuestions.some((question) => question.type === 'SIGNATURE');
  const { slug, guestToken } = link;
  useEffect(() => {
    if (!hasStatements) return;
    let isCurrent = true;
    fetchAcknowledgements(api, { slug, guestToken }).then(
      (fresh) => isCurrent && setRead(fresh),
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [api, slug, guestToken, hasStatements, version]);
  const agreements = useMemo(() => {
    if (!read || !record) return [];
    const statements = currentStatements(invitation, read);
    return doorAgreements(
      statements,
      coveredGuests(statements, read.records),
      comingPeople(record),
    );
  }, [invitation, read, record]);
  return {
    api,
    signing,
    agreements,
    signerId: record?.guest.id ?? null,
    version,
    agreed: () => setVersion((count) => count + 1),
  };
}

export type DoorAgreements = ReturnType<typeof useDoorAgreements>;
