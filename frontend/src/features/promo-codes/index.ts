/**
 * The organization's promo codes (docs/API.md §6, "Promo codes"; design PD-116 to PD-118). Every
 * read is in the browser, so there is no `index.server.ts`.
 */
export { PromoCodesPage } from './components/promo-codes-page';
export { loadPromoCodes, type PromoCodesData } from './load';
