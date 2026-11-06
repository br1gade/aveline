import { useTranslation } from 'react-i18next';

import { readPublicEnv } from '@/config/env';
import { supportContacts } from '@/lib/support';

/**
 * How to reach Aveline (design C-54), from the deployment's settings: the Help page, the price list
 * and the two payment errors show it. Telegram and WhatsApp leave the site, so they take no referrer.
 * `linkClassName` is the frame's own link look: the guest pages' Ivory and the app's kit differ. Each
 * link is a 44 px target, as a phone's thumb needs.
 */
export function SupportContacts({ linkClassName }: { linkClassName: string }) {
  const { t } = useTranslation('common');
  const contacts = supportContacts(readPublicEnv());
  if (contacts.length === 0) return <p className="m-0">{t('support.none')}</p>;
  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {contacts.map(({ kind, text, href }) => (
          <li key={kind}>
            <span>{t(`support.kind.${kind}`)}: </span>
            <a
              href={href}
              className={`inline-flex min-h-11 items-center ${linkClassName}`}
              {...(kind === 'whatsapp' || kind === 'telegram' ? { rel: 'noreferrer' } : {})}
            >
              {text}
            </a>
          </li>
        ))}
      </ul>
      <p className="m-0 text-sm">{t('support.languages')}</p>
    </div>
  );
}
