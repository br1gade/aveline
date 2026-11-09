import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { problemFrom, type Problem } from '@/api/problems';
import { browserSession } from '@/api/session';
import { ProblemAlert, StatusLine, WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { setGalleryUploads } from '../api';
import type { HostGallery } from '../load';

function useUploadsSetting(eventId: string, gallery: HostGallery) {
  const [source, setSource] = useState(gallery);
  const [isEnabled, setIsEnabled] = useState(gallery.uploadsEnabled);
  const [isSaving, setIsSaving] = useState(false);
  const [didEnable, setDidEnable] = useState<boolean | null>(null);
  const [refusal, setRefusal] = useState<Problem | null>(null);
  // Each read of the page is a new object, so a reload wins over an earlier save here.
  if (gallery !== source) {
    setSource(gallery);
    setIsEnabled(gallery.uploadsEnabled);
  }
  const toggle = async () => {
    setIsSaving(true);
    setRefusal(null);
    setDidEnable(null);
    try {
      const isSaved = await setGalleryUploads(browserSession().api, eventId, !isEnabled);
      setIsEnabled(isSaved);
      setDidEnable(isSaved);
    } catch (error) {
      setRefusal(problemFrom(error));
    } finally {
      setIsSaving(false);
    }
  };
  return { isEnabled, isSaving, didEnable, refusal, toggle };
}

/**
 * Whether guests can share new photos (FR-46, design PD-188; C-57: off on a new invitation). It acts
 * at once, as turning it off loses nothing, and the sentence changes only from the backend's answer.
 */
export function UploadsSetting({ eventId, gallery }: { eventId: string; gallery: HostGallery }) {
  const { t } = useTranslation('gallery');
  const setting = useUploadsSetting(eventId, gallery);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const refused = (status: number) => {
    if (status === 403) return t('host.refusedAction');
    return status === 404 ? t('host.uploads.noInvitation') : t('host.failed');
  };
  const said =
    setting.didEnable === null
      ? ''
      : t(setting.didEnable ? 'host.uploads.turnedOn' : 'host.uploads.turnedOff');
  return (
    <div className="flex max-w-[40rem] flex-col items-start gap-2">
      <p className="m-0">{t(setting.isEnabled ? 'host.uploads.on' : 'host.uploads.off')}</p>
      <Button
        variant="outline"
        className={WRAPPING_BUTTON}
        disabled={setting.isSaving}
        onClick={() => void setting.toggle()}
      >
        {t(setting.isEnabled ? 'host.uploads.turnOff' : 'host.uploads.turnOn')}
      </Button>
      {setting.refusal ? <ProblemAlert problem={setting.refusal} refused={refused} /> : null}
      <StatusLine statusRef={statusRef}>{said}</StatusLine>
    </div>
  );
}
