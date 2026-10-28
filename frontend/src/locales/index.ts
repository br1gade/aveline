import enAccount from './en/account.json';
import enApp from './en/app.json';
import enCommon from './en/common.json';
import enEvents from './en/events.json';
import enGuests from './en/guests.json';
import enInvitation from './en/invitation.json';
import enReply from './en/reply.json';
import enSending from './en/sending.json';
import enVenues from './en/venues.json';
import hyAccount from './hy/account.json';
import hyApp from './hy/app.json';
import hyCommon from './hy/common.json';
import hyEvents from './hy/events.json';
import hyGuests from './hy/guests.json';
import hyInvitation from './hy/invitation.json';
import hyReply from './hy/reply.json';
import hySending from './hy/sending.json';
import hyVenues from './hy/venues.json';
import ruAccount from './ru/account.json';
import ruApp from './ru/app.json';
import ruCommon from './ru/common.json';
import ruEvents from './ru/events.json';
import ruGuests from './ru/guests.json';
import ruInvitation from './ru/invitation.json';
import ruReply from './ru/reply.json';
import ruSending from './ru/sending.json';
import ruVenues from './ru/venues.json';

/**
 * Every namespace in every language. English is the source of the keys; Armenian and Russian are
 * drafts until a native reader checks them (design PD-9).
 */
export const resources = {
  en: {
    account: enAccount,
    app: enApp,
    common: enCommon,
    events: enEvents,
    guests: enGuests,
    invitation: enInvitation,
    reply: enReply,
    sending: enSending,
    venues: enVenues,
  },
  hy: {
    account: hyAccount,
    app: hyApp,
    common: hyCommon,
    events: hyEvents,
    guests: hyGuests,
    invitation: hyInvitation,
    reply: hyReply,
    sending: hySending,
    venues: hyVenues,
  },
  ru: {
    account: ruAccount,
    app: ruApp,
    common: ruCommon,
    events: ruEvents,
    guests: ruGuests,
    invitation: ruInvitation,
    reply: ruReply,
    sending: ruSending,
    venues: ruVenues,
  },
} as const;
