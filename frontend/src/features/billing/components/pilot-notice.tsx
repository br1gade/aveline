import { useTranslation } from 'react-i18next';

import { Notice } from '@/ui';

/**
 * Paid plans refused during the free pilot (design PD-127): a state of the service, not a failure,
 * so no error's look, no reference and nothing to try again. It says what stays usable.
 */
export function PilotNotice() {
  const { t } = useTranslation('billing');
  return (
    <Notice role="status">
      <strong className="block font-medium">{t('pilot.title')}</strong>
      {t('pilot.body')}
    </Notice>
  );
}
