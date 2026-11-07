/**
 * The day's running order (docs/API.md §6, "The running order"; design PD-106, PD-107): typed once,
 * read by the invitation's TIMELINE section, the vendors' brief and the operations view. Every read
 * is in the browser, so there is no `index.server.ts`.
 */
export { RunningOrderPage } from './components/running-order-page';
export { loadRunningOrder, type RunningOrderData } from './load';
