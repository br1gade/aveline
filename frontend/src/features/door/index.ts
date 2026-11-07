/**
 * The door (docs/API.md §6; design PD-90 to PD-94): letting people in on the day, by name or by a
 * ticket's code, undoing a mistake, who still must agree, and the counts. Every read is in the
 * browser, so there is no `index.server.ts`.
 */
export { DoorPage } from './components/door-page';
export { loadDoor } from './load';
