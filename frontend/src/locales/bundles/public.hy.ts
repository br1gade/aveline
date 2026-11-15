// The public pages: events, checkout, orders, briefs, Help and privacy, in Armenian: loaded by `locales/public.ts` (`load.ts`).
import brief from '../hy/brief.json';
import checkout from '../hy/checkout.json';
import privacyRequest from '../hy/privacy-request.json';
import publicEvent from '../hy/public-event.json';
import ticketOrder from '../hy/ticket-order.json';

export default {
  brief,
  checkout,
  'privacy-request': privacyRequest,
  'public-event': publicEvent,
  'ticket-order': ticketOrder,
};
