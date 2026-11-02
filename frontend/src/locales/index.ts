import enAccount from './en/account.json';
import enAgreements from './en/agreements.json';
import enApp from './en/app.json';
import enCommon from './en/common.json';
import enDesign from './en/design.json';
import enEvents from './en/events.json';
import enExports from './en/exports.json';
import enGallery from './en/gallery.json';
import enGuestAgreements from './en/guest-agreements.json';
import enGuests from './en/guests.json';
import enInvitation from './en/invitation.json';
import enReply from './en/reply.json';
import enSeating from './en/seating.json';
import enSending from './en/sending.json';
import enVenues from './en/venues.json';
import frAccount from './fr/account.json';
import frAgreements from './fr/agreements.json';
import frApp from './fr/app.json';
import frCommon from './fr/common.json';
import frDesign from './fr/design.json';
import frEvents from './fr/events.json';
import frExports from './fr/exports.json';
import frGallery from './fr/gallery.json';
import frGuestAgreements from './fr/guest-agreements.json';
import frGuests from './fr/guests.json';
import frInvitation from './fr/invitation.json';
import frReply from './fr/reply.json';
import frSeating from './fr/seating.json';
import frSending from './fr/sending.json';
import frVenues from './fr/venues.json';
import hyAccount from './hy/account.json';
import hyAgreements from './hy/agreements.json';
import hyApp from './hy/app.json';
import hyCommon from './hy/common.json';
import hyDesign from './hy/design.json';
import hyEvents from './hy/events.json';
import hyExports from './hy/exports.json';
import hyGallery from './hy/gallery.json';
import hyGuestAgreements from './hy/guest-agreements.json';
import hyGuests from './hy/guests.json';
import hyInvitation from './hy/invitation.json';
import hyReply from './hy/reply.json';
import hySeating from './hy/seating.json';
import hySending from './hy/sending.json';
import hyVenues from './hy/venues.json';
import ruAccount from './ru/account.json';
import ruAgreements from './ru/agreements.json';
import ruApp from './ru/app.json';
import ruCommon from './ru/common.json';
import ruDesign from './ru/design.json';
import ruEvents from './ru/events.json';
import ruExports from './ru/exports.json';
import ruGallery from './ru/gallery.json';
import ruGuestAgreements from './ru/guest-agreements.json';
import ruGuests from './ru/guests.json';
import ruInvitation from './ru/invitation.json';
import ruReply from './ru/reply.json';
import ruSeating from './ru/seating.json';
import ruSending from './ru/sending.json';
import ruVenues from './ru/venues.json';

import enCheckout from './en/checkout.json';
import enPublicEvent from './en/public-event.json';
import enTicketOrder from './en/ticket-order.json';
import enTicketOrders from './en/ticket-orders.json';
import enTicketSales from './en/ticket-sales.json';
import frCheckout from './fr/checkout.json';
import frPublicEvent from './fr/public-event.json';
import frTicketOrder from './fr/ticket-order.json';
import frTicketOrders from './fr/ticket-orders.json';
import frTicketSales from './fr/ticket-sales.json';
import hyCheckout from './hy/checkout.json';
import hyPublicEvent from './hy/public-event.json';
import hyTicketOrder from './hy/ticket-order.json';
import hyTicketOrders from './hy/ticket-orders.json';
import hyTicketSales from './hy/ticket-sales.json';
import ruCheckout from './ru/checkout.json';
import ruPublicEvent from './ru/public-event.json';
import ruTicketOrder from './ru/ticket-order.json';
import ruTicketOrders from './ru/ticket-orders.json';
import ruTicketSales from './ru/ticket-sales.json';
/**
 * Every namespace in every language. English is the source of the keys; Armenian and Russian are
 * drafts until a native reader checks them (design PD-9). French ships as translated (design C-23).
 */
export const resources = {
  en: {
    account: enAccount,
    agreements: enAgreements,
    app: enApp,
    checkout: enCheckout,
    common: enCommon,
    design: enDesign,
    events: enEvents,
    exports: enExports,
    gallery: enGallery,
    'guest-agreements': enGuestAgreements,
    guests: enGuests,
    invitation: enInvitation,
    'public-event': enPublicEvent,
    reply: enReply,
    seating: enSeating,
    sending: enSending,
    'ticket-order': enTicketOrder,
    'ticket-orders': enTicketOrders,
    'ticket-sales': enTicketSales,
    venues: enVenues,
  },
  fr: {
    account: frAccount,
    agreements: frAgreements,
    app: frApp,
    checkout: frCheckout,
    common: frCommon,
    design: frDesign,
    events: frEvents,
    exports: frExports,
    gallery: frGallery,
    'guest-agreements': frGuestAgreements,
    guests: frGuests,
    invitation: frInvitation,
    'public-event': frPublicEvent,
    reply: frReply,
    seating: frSeating,
    sending: frSending,
    'ticket-order': frTicketOrder,
    'ticket-orders': frTicketOrders,
    'ticket-sales': frTicketSales,
    venues: frVenues,
  },
  hy: {
    account: hyAccount,
    agreements: hyAgreements,
    app: hyApp,
    checkout: hyCheckout,
    common: hyCommon,
    design: hyDesign,
    events: hyEvents,
    exports: hyExports,
    gallery: hyGallery,
    'guest-agreements': hyGuestAgreements,
    guests: hyGuests,
    invitation: hyInvitation,
    'public-event': hyPublicEvent,
    reply: hyReply,
    seating: hySeating,
    sending: hySending,
    'ticket-order': hyTicketOrder,
    'ticket-orders': hyTicketOrders,
    'ticket-sales': hyTicketSales,
    venues: hyVenues,
  },
  ru: {
    account: ruAccount,
    agreements: ruAgreements,
    app: ruApp,
    checkout: ruCheckout,
    common: ruCommon,
    design: ruDesign,
    events: ruEvents,
    exports: ruExports,
    gallery: ruGallery,
    'guest-agreements': ruGuestAgreements,
    guests: ruGuests,
    invitation: ruInvitation,
    'public-event': ruPublicEvent,
    reply: ruReply,
    seating: ruSeating,
    sending: ruSending,
    'ticket-order': ruTicketOrder,
    'ticket-orders': ruTicketOrders,
    'ticket-sales': ruTicketSales,
    venues: ruVenues,
  },
} as const;
