import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

import { PublicFrame } from '@/features/public-event';
import { ROUTE_PATHS } from '@/route-paths';
import { Notice } from '@/ui';
import { SupportContacts } from '@/ui/support-contacts';

/** The notice's sections, in the order a reader looks for them. */
const SECTIONS = ['who', 'what', 'why', 'whoSees', 'howLong'] as const;

const LINK = 'text-action underline decoration-1 underline-offset-3';

/**
 * **A placeholder** privacy notice (design PD-194; C-50): what Aveline holds and why, in plain words,
 * so the data-request form and the Help page have somewhere to point. It says first, and loudly,
 * that it is not the notice: before launch it is rewritten and reviewed by a lawyer, and nobody
 * should rely on it until then. Kept out of search engines meanwhile.
 */
export function PrivacyNoticePage() {
  const { t } = useTranslation('privacy-request');
  return (
    <PublicFrame>
      <div className="flex flex-col gap-3">
        {/* "конфиденциальности" alone is wider than a 360 px screen at this size. */}
        <h1 className="text-heading m-0 font-serif text-[36px] leading-[42px] font-light [overflow-wrap:anywhere]">
          {t('notice.title')}
        </h1>
        <Notice tone="error">
          <strong className="font-medium">{t('notice.placeholder.title')}</strong>{' '}
          {t('notice.placeholder.body')}
        </Notice>
      </div>
      {SECTIONS.map((section) => (
        <section key={section} className="flex flex-col gap-2">
          <h2 className="type-heading-2 text-heading m-0">{t(`notice.${section}.title`)}</h2>
          <p className="m-0">{t(`notice.${section}.body`)}</p>
        </section>
      ))}
      <section className="flex flex-col gap-2">
        <h2 className="type-heading-2 text-heading m-0">{t('notice.rights.title')}</h2>
        <p className="m-0">{t('notice.rights.body')}</p>
        <Link
          to={ROUTE_PATHS.privacyRequest}
          className={`${LINK} inline-flex min-h-11 items-center self-start`}
        >
          {t('notice.rights.link')}
        </Link>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="type-heading-2 text-heading m-0">{t('notice.contact.title')}</h2>
        <SupportContacts linkClassName={LINK} />
      </section>
    </PublicFrame>
  );
}
