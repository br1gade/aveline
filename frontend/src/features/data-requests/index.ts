/**
 * Aveline's administrators working through data-subject requests (docs/API.md §6; design PD-167).
 * Never a customer's: a request reaches across every customer.
 */
export { DataRequestsPage } from './components/data-requests-page';
export { loadDataRequests } from './load';
