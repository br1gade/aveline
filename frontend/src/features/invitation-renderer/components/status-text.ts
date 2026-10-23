import { useTranslation } from 'react-i18next';

import type { ReplySummary } from './reply-summary';

/** "You’re attending · 3", or the status alone when the head count is unknown or not attending. */
export function useStatusText(reply: ReplySummary | null): string | null {
  const { t } = useTranslation('invitation');
  if (!reply) {
    return null;
  }
  const status = t(`status.${reply.status}`);
  return reply.status === 'ATTENDING' && reply.attendingCount
    ? t('status.withCount', { status, count: reply.attendingCount })
    : status;
}
