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

interface EventSetting {
  startsAt: Date;
  timezone: string;
  /** In the host's order; the first is where the event starts. */
  venues: { name: string; address: string; translations: unknown }[];
}

/**
 * When and where, for a message: the date in the event's time zone, written
 * as a `locale` reader writes dates, and the first venue. A message with only
 * a link reads as phishing (audit F-10); the rest is on the invitation.
 */
export function eventWhenAndWhere(event: EventSetting, locale: string): { eventDate: string; place: string } {
  const eventDate = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: event.timezone }).format(event.startsAt);
  const [venue] = event.venues;
  if (!venue) return { eventDate, place: '' };
  const name = translatedField(venue.translations, locale, 'name') ?? venue.name;
  const address = translatedField(venue.translations, locale, 'address') ?? venue.address;
  return { eventDate, place: [name, address].filter((part) => part.trim() !== '').join(', ') };
}
