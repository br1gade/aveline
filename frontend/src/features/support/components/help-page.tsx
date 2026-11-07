import { useTranslation } from 'react-i18next';

import { PublicFrame } from '@/features/public-event';
import { SupportContacts } from '@/ui/support-contacts';

/**
 * How to reach Aveline, for anyone (design C-54, PD-180): the contacts the deployment sets, and the
 * languages they are answered in. Linked from home, sign-in, the app's home and the price list.
 */
export function HelpPage() {
  const { t } = useTranslation('common');
  return (
    <PublicFrame>
      <div className="flex flex-col gap-3">
        <h1 className="text-heading m-0 font-serif text-[36px] leading-[42px] font-light">
          {t('support.title')}
        </h1>
        <p className="m-0">{t('support.lead')}</p>
      </div>
      <SupportContacts linkClassName="text-action underline decoration-1 underline-offset-3" />
    </PublicFrame>
  );
}
