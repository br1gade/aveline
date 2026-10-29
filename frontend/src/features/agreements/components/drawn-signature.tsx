import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { PrivateImage } from '@/ui';
import { Button } from '@/ui/kit/button';

import { agreementFile } from '../api';

interface DrawnSignatureProps {
  eventId: string;
  acknowledgementId: string;
  /** Who signed, for the image's description. */
  signerName: string;
}

/**
 * A drawn agreement's image, read only when asked for: with the bearer token, through the API, and
 * shown from memory (ARCHITECTURE §9).
 */
export function DrawnSignature({ eventId, acknowledgementId, signerName }: DrawnSignatureProps) {
  const { t } = useTranslation('agreements');
  const id = useId();
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="link"
        aria-expanded={isOpen}
        aria-controls={id}
        onClick={() => setIsOpen((open) => !open)}
        className="h-auto min-h-11 px-0"
      >
        {isOpen ? t('row.hideDrawing') : t('row.showDrawing')}
      </Button>
      <div id={id} hidden={!isOpen}>
        {isOpen ? (
          <PrivateImage
            id={acknowledgementId}
            load={(signal) =>
              agreementFile(browserSession().api, eventId, acknowledgementId, signal)
            }
            alt={t('row.drawingAlt', { name: signerName })}
            className="border-border h-auto max-h-40 w-full max-w-sm border bg-white object-contain"
            renderFailed={(retry) => (
              <span className="text-muted-foreground flex flex-col items-start gap-1 text-sm">
                {t('row.drawingFailed')}
                <Button variant="link" onClick={retry} className="h-auto min-h-11 px-0">
                  {t('row.retry')}
                </Button>
              </span>
            )}
          />
        ) : null}
      </div>
    </div>
  );
}
