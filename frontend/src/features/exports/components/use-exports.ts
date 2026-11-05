import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isApiError } from '@/api/errors';
import { createRetryKey } from '@/api/retry-key';
import { browserSession } from '@/api/session';
import { saveFile } from '@/ui/save-file';

import { createSnapshot, downloadSnapshot, getSnapshot } from '../api';
import { fileNameOf, isExpectedType } from '../files';
import { intentKey, sameIntentOf } from '../intent';
import {
  createRefusalOf,
  downloadRefusalOf,
  wrongTypeRefusal,
  type ExportRefusal,
} from '../refusals';
import { countActive, snapshotState } from '../states';
import type { Intent, Snapshot } from '../types';
import type { ExportText } from './use-export-text';
import { useSnapshotList, type SnapshotList } from './use-snapshot-list';

/** Where a refusal is said: under the form, or on the export's own row. */
export const AT_FORM = 'form';

export interface PlacedRefusal {
  /** `AT_FORM`, or the id of the export whose row was pressed. */
  at: string;
  refusal: ExportRefusal;
  /** What the press asked for, for the copy without contacts or the same export again. */
  intent: Intent;
  /** The export a download was for, to try it again. */
  snapshot?: Snapshot;
}

/** What both actions need from the page. */
interface Context {
  eventId: string;
  list: SnapshotList;
  place: (placed: PlacedRefusal | null) => void;
  say: (line: string) => void;
  text: ExportText;
}

/** After a 409 the history is read again: it counts what is going, and shows it. */
async function refusedCreate(
  error: unknown,
  intent: Intent,
  isKeyReused: boolean,
  list: SnapshotList,
): Promise<ExportRefusal> {
  const isConflict = isApiError(error) && error.status === 409;
  const read = isConflict ? await list.reload() : undefined;
  if (read) list.follow();
  const activeCount = countActive(read ?? list.snapshots);
  return createRefusalOf(error, { intent, isKeyReused, activeCount });
}

/**
 * Making an export, from the form or a row (design PD-74, PD-75). Each press sends a new UUID; the
 * same one again only after a press with the same choices that got no answer or a server failure,
 * either of which may have queued it.
 */
function useCreate({ eventId, list, place, say, text }: Context) {
  const { t } = useTranslation('exports');
  const retry = useRef(createRetryKey());
  const [creatingAt, setCreatingAt] = useState<string | null>(null);
  /** Whether the export was made, so the form can count its choices as done. */
  const create = async (intent: Intent, at: string): Promise<boolean> => {
    const intentName = intentKey(intent);
    const isKeyReused = retry.current.isPending(intentName);
    place(null);
    setCreatingAt(at);
    try {
      const key = retry.current.next(intentName);
      const made = await createSnapshot(browserSession().api, eventId, intent, key);
      retry.current.settle(null);
      list.apply([made]);
      list.follow();
      say(t('status.started', { what: text.what(made) }));
      return true;
    } catch (error) {
      retry.current.settle(error);
      place({ at, intent, refusal: await refusedCreate(error, intent, isKeyReused, list) });
      return false;
    } finally {
      setCreatingAt(null);
    }
  };
  return { create, creatingAt };
}

/**
 * A 410 and a 409 read the export again: the first to say whether it expired or was withdrawn,
 * the second to follow it. A 404 reads the whole history again.
 */
async function refusedDownload(
  error: unknown,
  snapshot: Snapshot,
  eventId: string,
  list: SnapshotList,
): Promise<ExportRefusal> {
  const status = isApiError(error) ? error.status : undefined;
  const isStale = status === 410 || status === 409;
  const reread = isStale
    ? await getSnapshot(browserSession().api, eventId, snapshot.id).catch(() => undefined)
    : undefined;
  if (reread) list.apply([reread]);
  const refusal = downloadRefusalOf(error, snapshot, reread);
  if (refusal.reloadsList) await list.reload();
  if (refusal.follows) list.follow();
  return refusal;
}

/**
 * Downloading through the API client, with the bearer token (design PD-76). The bytes are saved
 * from an object URL under the server's name; an answer of another type is refused, not saved.
 */
function useDownload({ eventId, list, place, say }: Context) {
  const { t } = useTranslation('exports');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const download = async (snapshot: Snapshot) => {
    const placed = { at: snapshot.id, intent: sameIntentOf(snapshot), snapshot };
    place(null);
    setDownloadingId(snapshot.id);
    try {
      const file = await downloadSnapshot(browserSession().api, eventId, snapshot.id);
      if (!isExpectedType(snapshot.format, file.contentType)) {
        place({ ...placed, refusal: wrongTypeRefusal() });
        return;
      }
      const name = fileNameOf(snapshot, file.filename);
      saveFile(file.blob, name);
      say(t('status.downloaded', { name }));
    } catch (error) {
      place({ ...placed, refusal: await refusedDownload(error, snapshot, eventId, list) });
    } finally {
      setDownloadingId(null);
    }
  };
  return { download, downloadingId };
}

/**
 * The exports page's actions and what they say. One refusal at a time, placed where its press
 * was; the status line says what started, ended and downloaded, without moving the focus.
 */
export function useExports(eventId: string, initial: readonly Snapshot[], text: ExportText) {
  const { t } = useTranslation('exports');
  const [status, setStatus] = useState('');
  const [refusal, setRefusal] = useState<PlacedRefusal | null>(null);
  const onEnded = (ended: readonly Snapshot[]) => {
    const last = ended.at(-1);
    if (!last) return;
    const key = snapshotState(last) === 'ready' ? 'status.ready' : 'status.failed';
    setStatus(t(key, { what: text.what(last) }));
  };
  const list = useSnapshotList(eventId, initial, onEnded);
  const context = { eventId, list, place: setRefusal, say: setStatus, text };
  const creating = useCreate(context);
  const downloading = useDownload(context);
  return { list, status, say: setStatus, refusal, ...creating, ...downloading };
}

export type Exports = ReturnType<typeof useExports>;
