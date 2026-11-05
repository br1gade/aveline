/**
 * Aveline's administrators resolving organizations' access reviews: a last owner asking to close, or
 * an organization left with no active owner (docs/API.md §6; design PD-175). Never a customer's.
 */
export { AccessReviewsPage } from './components/reviews-page';
export { loadAccessReviews } from './load';
