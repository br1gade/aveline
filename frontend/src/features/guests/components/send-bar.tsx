import { useTranslation } from 'react-i18next';

import type { SendProgress } from '@/features/sending';
import { Button } from '@/ui/kit/button';

interface SendBarProps {
  count: number;
  isSending: boolean;
  /** Which part is going, when more were chosen than one send takes. */
  progress: SendProgress | null;
  onChooseShown: () => void;
  onClear: () => void;
  onSend: () => void;
}

/**
 * Sending to the households chosen on the list (design PD-48), kept in view with the toolbar. The
 * send button is disabled only with its reason beside it, and while its request runs.
 */
export function SendBar({
  count,
  isSending,
  progress,
  onChooseShown,
  onClear,
  onSend,
}: SendBarProps) {
  const { t } = useTranslation('guests');
  const reason = count === 0 ? t('send.none') : '';
  const sending = progress ? t('send.sendingPart', { ...progress }) : t('send.sending');
  return (
    <div role="group" aria-label={t('send.label')} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p aria-live="polite" className="m-0 mr-2 text-sm font-medium">
          {t('send.chosen', { count })}
        </p>
        <Button variant="outline" onClick={onChooseShown}>
          {t('send.chooseShown')}
        </Button>
        {count > 0 ? (
          <Button variant="ghost" onClick={onClear}>
            {t('send.clear')}
          </Button>
        ) : null}
        <Button disabled={count === 0 || isSending} onClick={onSend}>
          {isSending ? sending : t('send.submit', { count })}
        </Button>
      </div>
      {reason ? <p className="text-muted-foreground m-0 text-sm">{reason}</p> : null}
    </div>
  );
}
