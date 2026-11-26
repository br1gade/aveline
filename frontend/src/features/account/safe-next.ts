import { APP_PATHS, ROUTE_PATHS } from '@/route-paths';
import { billingReturnPath } from '@/lib/routing/billing-return';

/**
 * Where to go after signing in. `?next=` comes from the address bar, so only a path inside the app
 * is followed, or the bank's return, which must confirm once signed in: anything else, another site
 * above all, goes to the app's home.
 */
export function safeNext(next: string | null): string {
  if (!next || next.includes('\\') || next.startsWith('//')) {
    return APP_PATHS.app;
  }
  if (next.startsWith(`${ROUTE_PATHS.billingPaymentReturn}?`)) {
    return billingReturnPath(new URL(next, 'https://app.invalid'));
  }
  const isInsideApp =
    next === ROUTE_PATHS.billingPaymentReturn ||
    next === APP_PATHS.app ||
    next.startsWith(`${APP_PATHS.app}/`) ||
    next.startsWith(`${APP_PATHS.app}?`);
  return isInsideApp ? next : APP_PATHS.app;
}
