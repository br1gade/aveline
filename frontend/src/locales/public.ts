import enBrief from './en/brief.json';
import enCheckout from './en/checkout.json';
import enPublicEvent from './en/public-event.json';
import enTicketOrder from './en/ticket-order.json';
import frBrief from './fr/brief.json';
import frCheckout from './fr/checkout.json';
import frPublicEvent from './fr/public-event.json';
import frTicketOrder from './fr/ticket-order.json';
import hyBrief from './hy/brief.json';
import hyCheckout from './hy/checkout.json';
import hyPublicEvent from './hy/public-event.json';
import hyTicketOrder from './hy/ticket-order.json';
import ruBrief from './ru/brief.json';
import ruCheckout from './ru/checkout.json';
import ruPublicEvent from './ru/public-event.json';
import ruTicketOrder from './ru/ticket-order.json';

import { addStrings } from './registry';

/** The public event, checkout, a buyer's order and a vendor's brief. Imported by their routes. */
addStrings({
  en: {
    brief: enBrief,
    checkout: enCheckout,
    'public-event': enPublicEvent,
    'ticket-order': enTicketOrder,
  },
  fr: {
    brief: frBrief,
    checkout: frCheckout,
    'public-event': frPublicEvent,
    'ticket-order': frTicketOrder,
  },
  hy: {
    brief: hyBrief,
    checkout: hyCheckout,
    'public-event': hyPublicEvent,
    'ticket-order': hyTicketOrder,
  },
  ru: {
    brief: ruBrief,
    checkout: ruCheckout,
    'public-event': ruPublicEvent,
    'ticket-order': ruTicketOrder,
  },
});
