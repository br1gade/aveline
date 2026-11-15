// The public pages: events, checkout, orders, briefs, Help and privacy, in Russian: loaded by `locales/public.ts` (`load.ts`).
import brief from '../ru/brief.json';
import checkout from '../ru/checkout.json';
import privacyRequest from '../ru/privacy-request.json';
import publicEvent from '../ru/public-event.json';
import ticketOrder from '../ru/ticket-order.json';

export default {
  brief,
  checkout,
  'privacy-request': privacyRequest,
  'public-event': publicEvent,
  'ticket-order': ticketOrder,
};
