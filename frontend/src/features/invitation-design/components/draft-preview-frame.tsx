import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Invitation } from '@/features/invitation-renderer';

import { readDraftMessage, READY_MESSAGE } from '../draft-message';
import { PreviewPage } from './design-preview';

/**
 * Inside the section page's frame (design PD-153): the page a section's unsaved form makes, drawn
 * by the invitation's own renderer at the frame's width, as a phone would. It says it is ready to
 * the page that framed it, and draws whatever that page sends; nothing else is listened to.
 */
export function DraftPreviewFrame({ eventId }: { eventId: string }) {
  const { t } = useTranslation('design');
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  // The route draws only in the browser, after its layout's client loader (`preview-layout.tsx`).
  const [isFramed] = useState(() => typeof window !== 'undefined' && window.parent !== window);
  useEffect(() => {
    if (!isFramed) return undefined;
    const expected = { origin: window.location.origin, source: window.parent };
    const listen = (event: MessageEvent) => {
      const message = readDraftMessage(event, expected);
      if (message?.kind === 'draft') setInvitation(message.invitation);
    };
    window.addEventListener('message', listen);
    window.parent.postMessage(READY_MESSAGE, window.location.origin);
    return () => window.removeEventListener('message', listen);
  }, [isFramed]);
  if (invitation) return <PreviewPage preview={invitation} eventId={eventId} />;
  return (
    <main className="p-4">
      <p className="m-0">{t(isFramed ? 'draftPreview.waiting' : 'draftPreview.notFramed')}</p>
    </main>
  );
}
