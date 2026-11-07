/**
 * The organization itself: its name, its members, inviting, leaving and asking to close it
 * (docs/API.md §6; design PD-159). An event's own team is `features/team`.
 */
export { getCurrentOrganization, listMembers } from './api';
export { OrganizationPage } from './components/organization-page';
export { loadOrganization } from './load';
export type { OrganizationMember } from './types';
