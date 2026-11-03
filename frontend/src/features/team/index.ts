/**
 * Who works on one event (docs/API.md §6; design PD-99, PD-100): its members, the invitations still
 * open, inviting, changing a role, removing. Accepting an invitation is in `features/account`. Every
 * read is in the browser, so there is no `index.server.ts`.
 */
export { TeamPage } from './components/team-page';
export { loadTeamPage, type TeamPageData } from './load';
