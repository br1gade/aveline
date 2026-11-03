import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/ui';
import { Alert, AlertDescription } from '@/ui/kit/alert';

interface WordedRefusalProps {
  /** The page's own words. */
  message: string;
  /** The backend's sentence, when the page has no words for it: marked as English. */
  english?: string | undefined;
  /** A failure's reference, which maps a report to the exact request (docs/API.md §1). */
  requestId?: string | undefined;
}

/** A refusal with an icon and words. It takes the focus when it appears (FR-6: worded, not hidden). */
export function WordedRefusal({ message, english, requestId }: WordedRefusalProps) {
  const { t } = useTranslation('common');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), [message, english]);
  return (
    <Alert ref={ref} variant="destructive" tabIndex={-1} className="outline-none">
      <Icon name="circle-alert" size={16} />
      <AlertDescription>
        {message}
        {english ? (
          <span lang="en" className="block">
            {english}
          </span>
        ) : null}
        {requestId ? <span className="block">{t('error.reference', { requestId })}</span> : null}
      </AlertDescription>
    </Alert>
  );
}
