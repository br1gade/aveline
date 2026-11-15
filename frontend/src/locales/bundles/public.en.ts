// The public pages: events, checkout, orders, briefs, Help and privacy, in English: loaded by `locales/public.ts` (`load.ts`).
import brief from '../en/brief.json';
import checkout from '../en/checkout.json';
import privacyRequest from '../en/privacy-request.json';
import publicEvent from '../en/public-event.json';
import ticketOrder from '../en/ticket-order.json';

export default {
  brief,
  checkout,
  'privacy-request': privacyRequest,
  'public-event': publicEvent,
  'ticket-order': ticketOrder,
};
