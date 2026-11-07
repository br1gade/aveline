import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { qrDrawing } from '../qr-drawing';

/**
 * A ticket's code to scan at the door (design PD-171, PD-172). It holds the code alone, as docs/API.md
 * says, so a phone's own camera finds nothing to open. Its accessible name is the holder's, never the
 * code's, which is a credential and sits as text just above for anyone who needs to read it out.
 */
export function TicketQr({ code, holder }: { code: string; holder: string }) {
  const { t } = useTranslation('ticket-order');
  const { size, path } = useMemo(() => qrDrawing(code), [code]);
  return (
    <div className="grid gap-2">
      <svg
        role="img"
        aria-label={t('ticket.qrFor', { holder })}
        viewBox={`0 0 ${size} ${size}`}
        shapeRendering="crispEdges"
        className="bg-surface text-ink h-auto w-full max-w-[16rem]"
      >
        <path d={path} fill="currentColor" />
      </svg>
      <p className="text-text-muted m-0 text-sm">{t('ticket.qrHint')}</p>
    </div>
  );
}
