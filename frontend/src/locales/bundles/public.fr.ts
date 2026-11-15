// The public pages: events, checkout, orders, briefs, Help and privacy, in French: loaded by `locales/public.ts` (`load.ts`).
import brief from '../fr/brief.json';
import checkout from '../fr/checkout.json';
import privacyRequest from '../fr/privacy-request.json';
import publicEvent from '../fr/public-event.json';
import ticketOrder from '../fr/ticket-order.json';

export default {
  brief,
  checkout,
  'privacy-request': privacyRequest,
  'public-event': publicEvent,
  'ticket-order': ticketOrder,
};
