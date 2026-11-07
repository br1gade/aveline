import { useCallback, useEffect, useState } from 'react';

import { isApiError } from '@/api/errors';
import { browserSession } from '@/api/session';
import {
  agreementsFrom,
  listAgreements,
  mergeNewest,
  readAllAgreements,
  requiredStatements,
  type Agreements,
  type RequiredStatement,
} from '@/features/agreements';
import type { EventDetail } from '@/features/events';
import { getDesign } from '@/features/invitation-design';

import { readDeadline } from '../api';

export type MustAgreeRead =
  /** Nothing is required, or not known yet: nothing to show. */
  | { kind: 'nothing' }
  /** The statements (`null`: not those either) or who agreed could not be read. The door still checks. */
  | { kind: 'unread'; statements: RequiredStatement[] | null }
  | {
      kind: 'ready';
      statements: RequiredStatement[];
      agreements: Agreements;
      /** `false` when the read stopped early, so someone listed may already have agreed. */
      isComplete: boolean;
    };

async function readAgreed(eventId: string) {
  const { items, isComplete } = await readAllAgreements(
    browserSession().api,
    eventId,
    readDeadline,
  );
  return { agreements: agreementsFrom(items), isComplete };
}

async function readStatements(event: EventDetail): Promise<RequiredStatement[]> {
  if (!event.invitation) return [];
  const design = await getDesign(browserSession().api, event.invitation.slug, readDeadline());
  return requiredStatements(design.questions);
}

/** What is not known yet, then who agreed; failing at either says so, for the next try. */
async function readFully(
  event: EventDetail,
  known: RequiredStatement[] | null,
): Promise<MustAgreeRead> {
  let statements = known;
  try {
    statements ??= await readStatements(event);
    if (statements.length === 0) return { kind: 'nothing' };
    return { kind: 'ready', statements, ...(await readAgreed(event.id)) };
  } catch (error) {
    if (!isApiError(error)) throw error;
    return { kind: 'unread', statements };
  }
}

/**
 * Who agreed, read after the page is up (design PD-93) and only when the event requires anything,
 * so most events read nothing here. Failing leaves the door working: the server decides.
 */
export function useMustAgree(event: EventDetail) {
  const [read, setRead] = useState<MustAgreeRead>({ kind: 'nothing' });

  useEffect(() => {
    void readFully(event, null).then(setRead);
  }, [event]);

  /** After a refusal, or on asking: the newest page holds whoever agreed since, so one read is enough. */
  const refresh = useCallback(async () => {
    if (read.kind === 'nothing') return;
    if (read.kind === 'unread') {
      setRead(await readFully(event, read.statements));
      return;
    }
    try {
      const { records } = await listAgreements(
        browserSession().api,
        event.id,
        undefined,
        readDeadline(),
      );
      setRead((before) =>
        before.kind === 'ready'
          ? { ...before, agreements: mergeNewest(before.agreements, records) }
          : before,
      );
    } catch (error) {
      if (!isApiError(error)) throw error;
    }
  }, [event, read]);

  return { read, refresh };
}
