import { translatedField } from '../../../common/field-translations';

/**
 * The event's title and hosts as a guest reading `locale` should see them: the
 * translation the host wrote for that language, else the plain columns. Every
 * message used the plain ones, so an English-reading guest got "An invitation
 * from Աննա և Դավիթ" though an English line existed.
 */
export function eventWording(
  event: { title: string; hosts: string; translations: unknown },
  locale: string,
): { eventTitle: string; hosts: string } {
  return {
    eventTitle: translatedField(event.translations, locale, 'title') ?? event.title,
    hosts: translatedField(event.translations, locale, 'hostsLabel') ?? event.hosts,
  };
}
