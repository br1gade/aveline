/**
 * A vendor's brief (docs/API.md §6, "Vendors and scoped briefs"; design PD-124, PD-125): the page a
 * vendor opens from their link, with no account. The token is held in memory only. Every read is
 * in the browser, so there is no `index.server.ts`.
 */
export { BriefPage } from './components/brief-page';
export { holdBrief } from './token-holder';
