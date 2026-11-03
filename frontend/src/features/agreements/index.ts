/**
 * Who agreed to the hosts' statements, for the hosts (docs/API.md §11; design PD-66). The guest's
 * side of agreeing is in the reply form (`features/guest-reply`, PD-52).
 */
export { listAgreements } from './api';
export { AgreementsPage } from './components/agreements-page';
export { loadAgreements, type AgreementsData } from './load';
