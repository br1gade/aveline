import { ROUTE_PATHS } from '@/route-paths';

export function billingReturnContext(url: URL) {
  const numbers = url.searchParams.getAll('invoice');
  const organizations = url.searchParams.getAll('organization');
  if (numbers.length !== 1 || organizations.length !== 1) return null;
  const number = numbers[0];
  const organizationId = organizations[0];
  if (!number || !/^AV-[0-9]{4}-[0-9]{6,20}$/.test(number)) return null;
  if (!organizationId || !/^[A-Za-z0-9_-]{1,64}$/.test(organizationId)) return null;
  return { number, organizationId };
}

export function billingReturnPath(url: URL): string {
  const context = billingReturnContext(url);
  const params = new URLSearchParams();
  if (context) {
    params.set('invoice', context.number);
    params.set('organization', context.organizationId);
  }
  const language = url.searchParams.get('lang');
  if (language && ['hy', 'en', 'ru', 'fr'].includes(language)) params.set('lang', language);
  const query = params.toString();
  return `${ROUTE_PATHS.billingPaymentReturn}${query ? `?${query}` : ''}`;
}
