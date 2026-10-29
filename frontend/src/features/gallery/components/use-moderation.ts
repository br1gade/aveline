import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRevalidator } from 'react-router';

import { isApiError } from '@/api/errors';
import { problemFrom, type Problem } from '@/api/problems';
import { browserSession } from '@/api/session';

import { moderatePhoto, removePhoto } from '../api';
import { withoutPhoto } from '../list';
import type { GalleryPhoto } from '../types';

export type Decision = 'APPROVED' | 'REJECTED';

/** What the page says after an action, once; `id` makes the same words speak again. */
interface Said {
  id: number;
  text: string;
}

/** A refusal for an action on a photo that is no longer as the page shows it: 404 or 409. */
function isStale(error: unknown): boolean {
  return isApiError(error) && (error.status === 404 || error.status === 409);
}

/**
 * The hosts' gallery, changed in place from each answer rather than read whole again (FR-47): a
 * decision returns the photo as it now is, and a removal drops it. A photo changed meanwhile (404,
 * 409) reloads the list. A status line says what happened and takes the focus, since the photo
 * often moves to another tab.
 */
export function useModeration(eventId: string, loadedPhotos: readonly GalleryPhoto[]) {
  const { t } = useTranslation('gallery');
  const { revalidate } = useRevalidator();
  const [source, setSource] = useState(loadedPhotos);
  const [photos, setPhotos] = useState<GalleryPhoto[]>([...loadedPhotos]);
  const [said, setSaid] = useState<Said | null>(null);
  const [refusal, setRefusal] = useState<Problem | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  if (loadedPhotos !== source) {
    setSource(loadedPhotos);
    setPhotos([...loadedPhotos]);
  }
  useEffect(() => {
    if (said) statusRef.current?.focus();
  }, [said]);
  const say = (text: string) => setSaid((before) => ({ id: (before?.id ?? 0) + 1, text }));

  const failed = async (error: unknown) => {
    if (!isStale(error)) return setRefusal(problemFrom(error));
    await revalidate();
    say(t('host.stale'));
  };
  const decide = async (photo: GalleryPhoto, decision: Decision) => {
    setRefusal(null);
    try {
      const changed = await moderatePhoto(browserSession().api, eventId, photo.id, decision);
      setPhotos((held) => held.map((item) => (item.id === changed.id ? changed : item)));
      say(t(decision === 'APPROVED' ? 'host.approved' : 'host.rejected'));
    } catch (error) {
      await failed(error);
    }
  };
  /** Resolves `true` once removed; a refusal is said on the page. */
  const remove = async (photo: GalleryPhoto): Promise<boolean> => {
    setRefusal(null);
    try {
      await removePhoto(browserSession().api, eventId, photo.id);
      setPhotos((held) => withoutPhoto(held, photo.id));
      say(t('host.removed'));
      return true;
    } catch (error) {
      await failed(error);
      return false;
    }
  };
  return { photos, said, refusal, statusRef, decide, remove };
}
