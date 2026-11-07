/**
 * Who must not be contacted (docs/API.md §6, "Suppression"; design PD-114, PD-115): the
 * organization's list, across every event. Every read is in the browser, so there is no
 * `index.server.ts`.
 */
export { SuppressionsPage } from './components/suppressions-page';
export { loadSuppressions, type SuppressionsData } from './load';
