/**
 * An event's seating (docs/API.md §6, "Tables and seating"; design PD-67 to PD-71): tables per
 * venue, seating by hand and automatically, and showing guests their tables. A guest's own table
 * is drawn by the invitation renderer from the personal page's `guest.seating`.
 */
export { SeatingPage } from './components/seating-page';
export { loadSeating, type SeatingData } from './load';
