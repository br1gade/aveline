import '@/locales/public';
import { data } from 'react-router';

import { readServerEnv } from '@/config/env.server';
import { CheckoutPage } from '@/features/checkout';
import { EventNotFound, publicEventLanguage, readBasket } from '@/features/public-event';
import { loadPublicEvent } from '@/features/public-event/index.server';
import { checkoutHeaders } from '@/lib/security/headers';

import type { Route } from './+types/checkout';

/**
 * Checkout, with the tickets chosen in the address (`?tickets=general.2`) and the event's language
 * (`?locale=`). The bank a paid order goes to is a server setting (design PD-82, FR-64).
 */
export async function loader({ params, request }: Route.LoaderArgs) {
  const search = new URL(request.url).searchParams;
  const page = await loadPublicEvent({
    slug: params.slug,
    locale: search.get('locale') ?? undefined,
  });
  const provider = readServerEnv().TICKET_PAYMENT_PROVIDER;
  return data(
    { ...page, tickets: search.get('tickets'), provider },
    { status: page.state === 'found' ? 200 : 404 },
  );
}

export function headers() {
  return checkoutHeaders();
}

export function meta({ loaderData }: Route.MetaArgs) {
  const headline = loaderData?.state === 'found' ? loaderData.event.headline : null;
  return [{ title: headline ?? 'Aveline' }, { name: 'robots', content: 'noindex, nofollow' }];
}

export const handle = { pageLanguage: publicEventLanguage };

export default function Checkout({ loaderData }: Route.ComponentProps) {
  if (loaderData.state === 'not-found') {
    return <EventNotFound />;
  }
  const { event } = loaderData;
  return (
    <CheckoutPage
      event={event}
      basket={readBasket(loaderData.tickets, event.ticketTypes)}
      isSalesClosed={loaderData.isSalesClosed}
      provider={loaderData.provider}
    />
  );
}
