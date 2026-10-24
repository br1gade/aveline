# Venues and Seating

How places are modelled, how they relate to each other, and how guests end up
in chairs.

---

## 1. Two layers: directory and booking

A venue appears in the system twice, deliberately.

```
VenueProfile  ──────────►  Venue  ──────────►  Table  ──────────►  Seat
(the directory)            (this event's       (furniture in      (a guest
                            booking)            a venue)           in a place)
```

**`VenueProfile`** is the reusable directory entry: "Riverside Hall, 120 seats,
Yerevan". It is shared across events and organizations, and links to a `Vendor`
when the venue is also a booked partner. It exists so the hundredth wedding at
a popular hall does not retype the address, and so we can answer "which venues
do we work with". One active curated VENUE vendor may operate several profiles;
each profile has at most one operator. Staff (`directory:manage`) set, reassign
or remove its `vendorId` independently. Organization-private vendors cannot be
linked. Directory responses expose only an eligible operator's ID and name,
never private contacts; retired/ineligible links are returned as null. Event
venue copies retain their own details after operator or directory changes.

**`Venue`** is *this event's* use of a place. It carries the role (`CEREMONY`,
`RECEPTION`, `AFTER_PARTY`, `PREPARATION`), the arrival time, and the capacity
agreed for this event — which may be lower than the hall's maximum.

`Venue.profileId` is nullable. A church, a family home, or a one-off location
needs no directory entry. Requiring one would make the common case harder for
no benefit.

### Why an event has many venues

An Armenian wedding is routinely three places in one day: a church, a
restaurant, and sometimes the bride's home. Modelling a single `venue` string
would have forced every downstream feature — the map block, the timeline, the
vendor brief — to special-case the second location. `TimelineEntry.venueId`
points each moment at the place it happens, which is what lets the invitation
render "Ceremony · 14:00 · Demo Cathedral" without duplicating anything.

---

## 2. Tables belong to a venue, not to the event

`SeatingArrangement` identifies each separately seated venue. Every event also
has an explicit unspecified arrangement for legacy tables with no venue.
`Table.arrangementId` is derived from its event and nullable `venueId` for all
writes; set `venueId` whenever the room is known. Dinner tables stand in the reception hall; the ceremony has none.
Attaching tables to the event alone would make a multi-venue seating plan
ambiguous the moment a second venue has seating.

`Table.zone` is a free-text grouping *inside* a venue — "main hall",
"terrace", "mezzanine". It is a string rather than a model because its only job
is grouping in the seating UI and on printed plans; a `Zone` entity would add a
join for no query we need.

| Field | Purpose |
|---|---|
| `capacity` | Seats at this table; seating validates against it |
| `zone` | Grouping inside the venue |
| `posX`, `posY`, `shape` | Canvas layout for the seating editor |

---

## 3. Seats

`Seat` links one `Table` to one `Guest` within an arrangement. Constraints carry
the rules:

- `(guestId, arrangementId)` is **unique** — one seat per person per arrangement.
  A person may sit at both the ceremony and reception.
- Table names are unique within an arrangement; both venues may have “Table 1”.
- Composite foreign keys keep the guest, table and arrangement on the same event.
  Database triggers derive arrangement/event fields for existing seed and bulk
  writers, and reject conflicting explicit fields.
- `(tableId, position)` is **unique** — two guests cannot hold the same place.

`position` is nullable: a host may assign a guest to a table without caring
which chair. It becomes meaningful when printing place cards.

**An event-wide decline gives up every seat.** Every RSVP write goes through
one function, which deletes the person's seats and records one `SeatRelease`
per arrangement. The table's count is then true, and each plan shows its own
release flag. Reseating or dismissing a flag clears only the chosen arrangement.
The old `Guest.seatReleasedAt` / `seatReleasedFromTableId` columns are retained
as historical migration input; current views read `SeatRelease`.

**Attendance is versioned.** Hosts choose EVENT_WIDE or PER_VENUE through
preview and confirmation. Every guest-facing venue is eligible for every person;
preparation/internal-only venues stay hidden. A transition keeps earlier answers
as history and resets current attendance without guessing venue answers. Current
personal and household forms show the revision and require fresh attendance;
stale submissions are rejected. Dietary/custom answers and check-ins remain.

Existing seats become flagged reservations and still occupy capacity. Per-venue
answers apply to each person; a decline releases only that venue's seats.
Automatic seating excludes pending/undecided/declined venue attendance and does
not seat the unspecified arrangement in per-venue mode. A new venue starts
pending. Answered venues cannot be hidden/deleted; role and timeline edits are
guarded so history never disappears from the current invitation accidentally.

**Auto-seating locks one arrangement.** It first shares the event policy lock, then locks guest keys and available
attending answers before locking the arrangement and its tables, then reads,
plans and writes in the same transaction. Busy/changed answers defer the entire
household with an `unseated` explanation; refresh and run again after the edit.
Skipping busy answers avoids deadlocking against a household submission. Manual
seating shares the policy lock and takes guest keys before answer locks, matching host RSVP write order. Manual assignment takes the same arrangement lock before the
table lock, enforcing both table and venue capacity even across different tables.
Guests already seated elsewhere remain eligible for this room. Late acceptors
join their family only within the selected arrangement.

`GET /events/:eventId/seating/arrangements` lists the available plans.
Automatic seating and unassignment accept `?arrangementId=...`; omission is
allowed only when at most one arrangement has tables or release history. An
ambiguous request returns `400` and changes nothing. Assignment selects the
arrangement through its target table.

Changing a table's venue requires it to have neither seats nor release markers.
An empty table can move to a different arrangement, subject to that arrangement's
name uniqueness. Removing a venue requires moving its tables/timeline entries
and dismissing release history first. Lowering table/venue capacity cannot put
existing occupants or numbered chairs outside the new limit.

### Find-your-seat

A guest sees their venue-labelled assignments on their own invitation link, and only once the host
publishes the seating (`POST /events/:eventId/seating/publish`, which sets
`Event.seatingPublishedAt`). They see their own household's tables and no one
else's; the shared page carries none. Decided 9 October 2026 (D4): a public
lookup by name listed strangers' tables to anyone, and a plan shown before the
host is ready sends people to the wrong table.

It reads from the same `Seat` rows the organizer assigned — there is no
second data source to keep in sync, so a change after publishing shows at
once. The legacy single `table` field is null if several assignments exist;
clients use the new assignment arrays. Preparation and exclusively internal
venues stay hidden, including their seating names.

---

## 4. Seating constraints come from the guest graph

This is why the guest graph was modelled the way it is. Seating is not a
matter of distributing N people across M tables; it is constraint satisfaction
over relationships the RSVP already captured:

| Constraint | Source |
|---|---|
| Keep a household together | `Guest.householdId` |
| Balance or separate the two sides | `Guest.attribution` (`SIDE_A` / `SIDE_B`) |
| Seat only confirmed attendees | Event-wide RSVP, or current policy answer for the selected venue |
| Respect table capacity | `Table.capacity` |
| Respect venue capacity | `Venue.capacity` |

Every one of these is already in the database by the time seating begins,
because the invitation asked for it. A flat guest list with a `plusOnes: 2`
integer can express none of them, which is why households exist.

---

## 5. Performance note

Seating is the one genuinely CPU-bound operation in the product. A 400-guest
wedding across 40 tables is a bin-packing problem with grouping constraints —
NP-hard in general.

The current bounded planner uses:

1. **Greedy seeding** — place households largest-first into tables with room,
   preferring tables already holding the same side. O(n log n).
2. **Capacity budget** — place households only while the selected venue has
   enough remaining seats. Households that cannot fit are returned with reasons.
   Local improvement by bounded pairwise swaps remains future work.
3. **Keep the request short.** Auto-seating queues a durable job; a dedicated
   worker computes outside database transactions. It checks arrangement and
   attendance revisions before atomically applying. Manual drag-and-drop stays
   a direct write: one seat, with the table locked while it is counted.

Exact optimization is explicitly rejected. A good-enough plan a human then
adjusts is the product; a provably optimal plan computed in ninety seconds is
not.

---

Attendance policy transitions and venue/timeline mutations take the event lock
exclusively before arrangement/answer locks. Ordinary RSVP/seating writers share
it first. This prevents obsolete writes and avoids venue-edit/decline lock cycles.
Automatic seating takes that fence exclusively during application. Database
triggers advance arrangement revisions for seating, guest, attendance, venue and
timeline writes, including raw cancellation SQL and erasure. Changed or busy
inputs discard the computed plan and retry, at most three claims. Existing seats
remain untouched. See [worker operations](../backend/docs/SEATING_WORKER.md).

## 6. Not yet built

1. **Zone and adjacency preferences.** The planner keeps households together
   and prefers a table where their side of the family already sits; it does not
   yet honour "these two households near each other" or "keep this table away
   from the speakers".
2. **Re-planning.** `auto-assign` is additive and never moves a seated guest,
   so it cannot find a packing that requires rearranging. Unseating first is
   the current answer.
3. **Floor plan editor** persistence beyond a table's `posX` / `posY` /
   `shape`, which `PATCH /tables/:tableId` stores — rotation, room outlines,
   non-table objects.
4. **Print acceptance.** Snapshot PDFs include venue/table rosters with counts
   and six 90 × 70 mm flat place cards per A4; synthetic layout checks pass.
   Four-language snapshot headings are implemented; human language review and
   physical venue printouts remain pilot acceptance work.
5. **Worker pilot acceptance.** Automatic seating now uses durable worker jobs.
   Frontend polling and production recovery/load rehearsal
   remain; manual assignment stays immediate.
