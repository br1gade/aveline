/**
 * An event as `GET /events` lists it (docs/API.md §6). Interim until FR-1: only the fields the
 * list reads are typed.
 */
export interface EventSummary {
  id: string;
  title: string;
  /** ISO 8601 UTC. Shown in `timezone`, the event's own zone (docs/API.md §1). */
  startsAt: string;
  timezone: string;
}
