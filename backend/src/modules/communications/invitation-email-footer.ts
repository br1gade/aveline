import { MessageChannel } from '@prisma/client';
import { appPage } from '../../common/app-url';
import { resolveTranslation } from '../../common/locale';

const PRIVACY_LABEL = {
  hy: 'Անձնական տվյալների վերաբերյալ հարցում',
  en: 'Make a request about your personal data',
  ru: 'Подать запрос о персональных данных',
  fr: 'Faire une demande concernant vos données personnelles',
};

export function invitationEmailFooter(message: { channel: MessageChannel; templateKey: string; locale: string }) {
  if (message.channel !== MessageChannel.EMAIL || message.templateKey !== 'invitation.send') return '';
  const language = message.locale.toLowerCase().split('-')[0];
  const label = resolveTranslation<string>(PRIVACY_LABEL, language, 'hy');
  return ['','', `${label} — ${appPage('/privacy-request')}`, websiteLine()].filter((line) => line !== null).join('\n');
}

function websiteLine() {
  const website = URL.parse(process.env.PUBLIC_SITE_URL ?? '');
  if (!website || !['https:', 'http:'].includes(website.protocol) || website.username || website.password) return null;
  return `Aveline — ${website.href}`;
}
