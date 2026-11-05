import { useTranslation } from 'react-i18next';

import { Notice } from '@/ui';

import type { ReplyRecord } from '../types';

/** After the host changed how guests answer, every answer counts again from nothing (PD-51). */
export function ReconfirmNotice({ record }: { record: ReplyRecord }) {
  const { t } = useTranslation('reply');
  if (!record.attendance.needsReconfirmation) return null;
  return <Notice>{t('venues.reconfirm')}</Notice>;
}
