import { useTranslation } from 'react-i18next';

import { Notice } from '@/ui';

/**
 * Paid plans during the free pilot (design C-47): a state of the service, not a failure, so no
 * error's look, no reference and nothing to try again. Said before anyone chooses; after a refused
 * press it also says that nothing was charged and what stays usable.
 */
export function PilotNotice({ isRefused = false }: { isRefused?: boolean }) {
  const { t } = useTranslation('billing');
  return (
    <Notice role="status">
      <strong className="block font-medium">{t('pilot.title')}</strong>
      {isRefused ? t('pilot.body') : null}
    </Notice>
  );
}
