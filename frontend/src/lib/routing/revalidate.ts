import type { ShouldRevalidateFunctionArgs } from 'react-router';

type Revalidation = Pick<
  ShouldRevalidateFunctionArgs,
  'currentUrl' | 'nextUrl' | 'defaultShouldRevalidate'
>;

/** The same page with another query: a search or a filter, written into the address. */
function isQueryOnlyChange({ currentUrl, nextUrl }: Revalidation): boolean {
  return currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search;
}

/**
 * For a route whose data no query changes. React Router reloads every loader when the query
 * changes, so each search typed on the guest list would fetch the whole list again. An explicit
 * revalidation keeps the address, so it still reloads.
 */
export function revalidateUnlessQueryOnly(args: Revalidation): boolean {
  return isQueryOnlyChange(args) ? false : args.defaultShouldRevalidate;
}

/**
 * For the `/app` segment, whose only data is the negotiated language (design PD-40): it is
 * negotiated again when the switcher changes `?lang=`, and on nothing else.
 */
export function revalidateOnLanguage({ currentUrl, nextUrl }: Revalidation): boolean {
  return currentUrl.searchParams.get('lang') !== nextUrl.searchParams.get('lang');
}
