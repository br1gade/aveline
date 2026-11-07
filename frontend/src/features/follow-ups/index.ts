/**
 * Chasing who has not answered and thanking guests afterwards (docs/API.md §6; design PD-95 to
 * PD-98). It reads the guest list and the delivery report, so it sits above `guests` and `sending`,
 * which already import each other's way. Every read is in the browser, so there is no
 * `index.server.ts`.
 */
export { FollowUpsPage } from './components/follow-ups-page';
export { loadFollowUps, type FollowUpsData } from './load';
