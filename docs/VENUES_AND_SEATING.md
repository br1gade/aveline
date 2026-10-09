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
do we work with".

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

`Table.venueId` is nullable but should be set whenever an event has more than
one venue. Dinner tables stand in the reception hall; the ceremony has none.
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

`Seat` links one `Table` to one `Guest`. Two constraints carry the rules:

- `guestId` is **unique** — a guest cannot be seated twice.
- `(tableId, position)` is **unique** — two guests cannot hold the same place.

`position` is nullable: a host may assign a guest to a table without caring
which chair. It becomes meaningful when printing place cards.

### Find-your-seat

`GET /api/events/:eventId/find-seat?q=` is the guest-facing lookup: a guest
types their name on their phone at the venue and gets their table. It reads
from the same `Seat` rows the organizer assigned — there is no second data
source to keep in sync.

---

## 4. Seating constraints come from the guest graph

This is why the guest graph was modelled the way it is. Seating is not a
matter of distributing N people across M tables; it is constraint satisfaction
over relationships the RSVP already captured:

| Constraint | Source |
|---|---|
| Keep a household together | `Guest.householdId` |
| Balance or separate the two sides | `Guest.attribution` (`SIDE_A` / `SIDE_B`) |
| Seat only confirmed attendees | `Rsvp.status = ATTENDING` |
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

The intended approach when it is built:

1. **Greedy seeding** — place households largest-first into tables with room,
   preferring tables already holding the same side. O(n log n).
2. **Local improvement** — bounded pairwise swaps to reduce split households
   and side imbalance. Capped by iteration count, not run to convergence.
3. **Keep the request short.** Auto-seating runs inside the request today —
   bounded, and fast at wedding scale — and should move to a job before
   events of thousands (see §6). Manual drag-and-drop is a direct write and
   must stay O(1): one seat, with the table locked while it is counted.

Exact optimization is explicitly rejected. A good-enough plan a human then
adjusts is the product; a provably optimal plan computed in ninety seconds is
not.

---

## 6. Not yet built

1. **Zone and adjacency preferences.** The planner keeps households together
   and prefers a table where their side of the family already sits; it does not
   yet honour "these two households near each other" or "keep this table away
   from the speakers".
2. **Re-planning.** `auto-assign` is additive and never moves a seated guest,
   so it cannot find a packing that requires rearranging. Unseating first is
   the current answer.
3. **Venue capacity.** `Table.capacity` is enforced on every assignment;
   `Venue.capacity` is copied from the directory entry and stored, but not
   checked against the headcount.
4. **Floor plan editor** persistence beyond a table's `posX` / `posY` /
   `shape`, which `PATCH /tables/:tableId` stores — rotation, room outlines,
   non-table objects.
5. **Printed outputs as PDF** — place cards and the seating chart export as
   CSV today.
6. **Auto-seating as a job.** It runs in the request; fine at hundreds of
   guests, not at thousands.
