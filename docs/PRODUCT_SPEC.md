# Aveline — Product Specification

**Status:** draft v0.2
**Scope:** custom event invitations, event organization, and event management.
**Audience:** the team building and operating Aveline.

---

## 1. What Aveline is

> **Aveline is the operating system for an event. The invitation is its front door.**

We do not sell an invitation. We sell the capability to **run an event well**, beginning with a beautiful invitation and continuing through every operational decision the hosts face between sending it and the day itself.

The product rests on three claims:

1. **The invitation is the highest-leverage data-collection moment in an event.** Every guest touches it, voluntarily, weeks in advance. Capture structured data there and most downstream planning becomes derivable rather than manual.
2. **The work *after* the invitation is where the pain and the money are.** Headcounts, seating, dietary requirements, bar quantities, vendor briefs, day-of coordination. Today hosts do this in spreadsheets, phone calls and group chats.
3. **A real data model is the moat.** The category is served by static page builders and by agencies running on no software at all. An actual domain model — guests, households, attribution, constraints — is not something a page template can grow into.

### What Aveline is not

- **Not the cheapest invitation.** We do not compete on price against single-page vendors.
- **Not a design tool.** Hosts do not want to design; they want it done beautifully and fast.
- **Not a full-service agency.** We do not cater or decorate. We coordinate those who do, and stay asset-light.

---

## 2. Market context

The regional market splits into two poles with nothing between them.

**Single-artifact vendors** sell one personalized web page per event for a one-time fee, typically in the 9,000–35,000 AMD band. Delivery is manual: the host sends details over a messaging app, a human assembles the page from a template, a link comes back within hours or days. Customization is limited to text, dates, names, photos, dress code, music and a choice of preset fonts. There is no account, no dashboard, and no data retained beyond the page itself.

**Event production agencies** sell end-to-end execution — design, planning, catering, venue selection — coordinated through a network of specialist partners. They quote custom, require a deposit to book, and publish no pricing. Their digital presence is a brochure with a contact form. They run their operations on no software.

Two structural facts follow:

- **Rich guest data is routinely collected and then discarded.** RSVP forms across the category already ask for attendance, which host invited the guest, plus-one names, drink preference, and song requests. All of it lands in a notification email. Drink preference is a bar order. Song requests are a playlist. Attribution and plus-ones are a seating chart. Nobody connects them to anything.
- **Operational tooling does not exist at any price point.** No guest list management, no live headcount, no seating, no dietary tracking, no check-in, no vendor coordination, no analytics — at any tier, from any vendor.

That operational middle is the opportunity, and it is what this specification describes.

---

## 3. Product architecture

Everything hangs off one shared entity: **the Event**.

```
                        EVENT
         (type × date × venues × hosts × languages)
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   INVITATION         GUEST GRAPH        OPERATIONS
   (front door)      (the spine)        (the value)
        │                 │                 │
   • templates       • guest list      • headcounts
   • blocks          • RSVP answers    • seating chart
   • languages       • households      • bar & menu qty
   • music           • attribution     • dietary list
   • countdown       • plus-ones       • playlist
   • map/timeline    • dietary         • vendor briefs
   • dress code      • language pref   • day-of timeline
   • RSVP form       • check-in        • arrivals
        │                 │                 │
        └─────────────────┼─────────────────┘
                          ▼
                   VENDOR NETWORK
        (venue, catering, decor, photo, music, print)
                          ▼
                    POST-EVENT
         (photo gallery, thank-yous, guest book)
```

The critical property: **data flows one way and is never re-entered.** A venue address typed once appears in the invitation's venue block, the map block, the day-of timeline and the vendor brief. An RSVP answer given once appears in the headcount, the seating constraint set, the catering sheet and the bar sheet.

---

## 4. Domain model

The entities below are the ones the product argument rests on. The complete
inventory — 47 models, what each is for, and the invariants the database
enforces — is in [DATA_MODEL.md](../backend/docs/DATA_MODEL.md).

| Entity | Purpose |
|---|---|
| **Organization** | Tenant: a couple, a family, a company, or a planner |
| **User** | An account holder. Guests, buyers and vendors have none |
| **Event** | The root aggregate, carrying visibility and locales |
| **Venue** · **VenueProfile** | This event's booking / the reusable directory entry |
| **Invitation** · **InvitationBlock** | The published page and its sections |
| **DesignTemplate** | What a template can render, so customization stays safe |
| **Household** | The unit invitations and seating operate on |
| **Guest** | A person, reached by capability token |
| **Rsvp** | The response every operational view is derived from |
| **Table** · **Seat** | Furniture, and who sits where |
| **EventListing** | The public face of a public event |
| **TicketType** · **TicketOrder** · **Ticket** | Capacity, a purchase, an admitted person |
| **Payment** | A charge, with every transition recorded |
| **Plan** · **Subscription** | The recurring revenue line (§9.4) |
| **Message** | One outbound message — the only way the product reaches anyone |
| **Vendor** · **VendorBooking** | The partner network, with scoped briefs |

Access control — who may do what, and how guests and vendors reach the system
without accounts — is in [ACCESS_CONTROL.md](ACCESS_CONTROL.md). Venues and
seating are detailed in [VENUES_AND_SEATING.md](VENUES_AND_SEATING.md), the
design system in [INVITATION_DESIGN.md](INVITATION_DESIGN.md).

### Why households matter

Plus-ones are not a count, they are people. A household has an entitlement ("2 seats"), a primary guest, and members who may be named later. Seating, catering and check-in all operate on households, not on individuals in isolation. This single modelling decision is what makes seating tractable and what a flat guest list cannot express.

---

## 5. The invitation

### 5.1 Block library

Each block is data-bound to the Event: edit the Event once and every block that references it updates. Hosts may reorder blocks and switch any of them off.

| Block | Content |
|---|---|
| **Hero** | Host names, event type, date, cover image |
| **Story** | Introduction / invitation text |
| **Countdown** | Days, hours, minutes, seconds to the event |
| **Music** | Background audio with an explicit on/off control |
| **Venue** | Each venue with name, full address and role (ceremony, reception) |
| **Map** | Directions to each venue |
| **Timeline** | The agenda: ceremony, guest reception, first dance, cake, fireworks, close |
| **DressCode** | Guidance plus a colour palette |
| **Notes** | Host requests: children policy, gifts vs. flowers, footwear, phone policy |
| **Gallery** | Photographs of the hosts |
| **Rsvp** | The questionnaire (§5.3) |
| **Chat** | Link to a guest group chat |
| **Contact** | Organizer name and a tap-to-call action |

### 5.2 Customization model

Hosts do not design. They choose a template and we bind their data to it. Within a template they may change text, dates, names, photographs, dress code and colour palette; swap or disable music; select a font from the template's curated set; and remove any block.

**Revisions are unlimited at every tier.** Because blocks are data-bound, a change costs us nothing. Rationing revisions is the single most irritating constraint in this category and we decline to adopt it.

### 5.3 RSVP intake

The RSVP is a configurable questionnaire, not a fixed form. Every question has a declared **downstream consumer** — if an answer feeds nothing, we do not ask it.

| Question | Type | Feeds |
|---|---|---|
| Full name | text | guest identity |
| Will you attend? | yes / no / undecided | live headcount, catering |
| Which host invited you? | single choice | seating constraints, attribution reporting |
| Names of your party | text / repeater | household members, place cards |
| Dietary requirements | multi-choice + free text | catering sheet |
| Drink preference | single choice | bar order |
| Song request | text | playlist |
| Preferred language | single choice | per-guest invitation language |
| Free message to the hosts | text | guest book |

**One link answers for the household.** Whoever opens it answers for every
named member, each attending or not, in one submission — decided 8 October
2026, because families split ("we're coming, grandma can't travel") and
catering and seating count people, not households.

### 5.4 Per-guest personalization

Each guest receives their own invitation link. The page addresses them by name, renders in their language, and shows the plus-one allowance their household actually has. The same event therefore produces many personalized pages from one definition.

### 5.5 Multi-language

Armenian, Russian and English at minimum, extensible. Language is a property of content, not of the template: a block carries a translation per active language. Diaspora events frequently need all three simultaneously.

---

## 6. Operations

Every operations surface is a **derived view** over the guest graph. Nothing here is separately maintained; it all falls out of data the guests themselves provided.

| Surface | What it does |
|---|---|
| **Live headcount** | Confirmed / declined / pending, by household and by side, with a response-rate trend |
| **Seating chart** | Drag-and-drop table assignment, constrained by household (keep together) and attribution (balance sides). Publishes a guest-facing *find your seat* lookup |
| **Catering sheet** | Confirmed headcount plus every dietary requirement, exportable for the venue |
| **Bar sheet** | Drink preferences aggregated into quantities |
| **Playlist** | Song requests, deduplicated, exportable for the musician or DJ |
| **Day-of timeline** | The running order, shared with vendors and the coordinator |
| **Arrivals / check-in** | Guests checked in from a phone on the day; live arrival count |
| **Guest messages** | Free-text messages collected into a guest book |

---

## 7. Services provided

Aveline sells across three layers. The first is product; the second and third are coordinated service.

### 7.1 Event taxonomy

Event type and deliverable are **separate dimensions**. Conflating them produces an unusable catalogue.

```
EVENT TYPE                    DESIGN COMPONENT
├── Wedding                   ├── Main table
├── Engagement                ├── Guest tables
├── Baptism                   ├── Photo zone
├── Birthday / anniversary    ├── Bride's room
├── Corporate                 ├── Home
└── Other                     ├── Church / ceremony site
                              └── Details & stationery
```

Any event type may require any combination of components. Quotes are built from the intersection.

### 7.2 Service catalogue

| Layer | Service | Delivery |
|---|---|---|
| **Product** | Invitation design & publication | In-house |
| **Product** | Guest management & RSVP | In-house, self-serve |
| **Product** | Operations suite (§6) | In-house, self-serve |
| **Product** | Per-guest personalization & translation | In-house |
| **Coordination** | Venue selection | Partner network |
| **Coordination** | Catering | Partner network |
| **Coordination** | Decorative design | Partner network |
| **Coordination** | Photography & video | Partner network |
| **Coordination** | Music & entertainment | Partner network |
| **Coordination** | Printed companion stationery | Partner network |
| **Managed** | Consultation & event design | In-house coordinator |
| **Managed** | Planning & timeline construction | In-house coordinator |
| **Managed** | Day-of coordination | In-house coordinator |
| **Post-event** | Shared photo gallery | In-house |
| **Post-event** | Digital guest book | In-house |
| **Post-event** | Thank-you note flow | In-house |

### 7.3 Vendor network

Partners receive **scoped access to exactly the brief they need** and nothing else:

- Caterer → confirmed headcount, dietary requirements, service timeline
- Bar → drink quantities
- Musician / DJ → playlist, timeline cues
- Venue → seating plan, headcount, access times
- Photographer → timeline, key moments, household groupings for formal photographs

Revenue is a referral margin or listing fee. We never hold vendor inventory.

### 7.4 Delivery process

```
Enquiry → Consultation → Event setup → Invitation design
   → Guest list build → Send → RSVP collection
   → Operations planning → Vendor briefing → Event day
   → Post-event
```

**Commitment model:** a deposit confirms a booking. Managed-tier engagements should begin several weeks to several months before the event date, depending on scale.

Card acquiring runs through Armenian bank gateways — Ameriabank, Inecobank and
IDBank — which also carry Visa, Mastercard, ArCa and Apple Pay. See
[PAYMENTS.md](PAYMENTS.md). The payment core is built and tested; wiring a
captured deposit to a confirmed booking is not.

---

## 8. Packaging

Tiers gate **capability**, never artificial scarcity. Revisions, languages and section counts are not rationed.

| | **Invitation** | **Managed** | **Production** |
|---|---|---|---|
| Positioning | a beautiful front door | run your own event well | we run it with you |
| Invitation page | full block set | + per-guest personalization | + custom design |
| Languages | 1 | up to 3 | unlimited |
| Revisions | unlimited | unlimited | unlimited |
| Guest list & RSVP | basic responses | full guest graph | full guest graph |
| Live headcount | — | ✓ | ✓ |
| Seating + find-your-seat | — | ✓ | ✓ |
| Catering / bar / playlist sheets | — | ✓ | ✓ |
| Day-of check-in | — | ✓ | ✓ |
| Vendor coordination | — | self-serve briefs | managed |
| Human coordinator | — | — | ✓ |
| Post-event gallery & thank-yous | — | ✓ | ✓ |
| Invitation stays live | 3 months | indefinitely | indefinitely |

Entry pricing sits at the premium end of the single-artifact band, because we are not selling that artifact. The Managed tier is priced against **the planner's time saved**, not against the cost of printing. Specific price points are open (§12). **Decided (8 October 2026):** the pilot runs free — paid tiers stay inactive and entitlements are published but not enforced until real events show what to charge and which limits matter.

---

## 9. Revenue model

A one-time fee on a one-time event is the category's structural weakness. Aveline needs more than one line.

| # | Stream | Mechanism | Note |
|---|---|---|---|
| 1 | **Event package** | Tiered one-time fee per event | Core |
| 2 | **Operations tier** | Upsell onto the operations suite | The actual differentiator — price it as one |
| 3 | **Vendor referral** | Margin or fee from network partners | Scales with event value, not invitation count |
| 4 | **Organizer subscription** | Monthly, for planners and agencies | **The only recurring line** |
| 5 | **Corporate** | Annual contract, multiple branded events | Repeatable, budgeted |
| 6 | **Add-ons** | Photoshoot, print companion, extra languages, guest book | Incremental |

**Stream 4 is the strategic one.** A planner running thirty events a year is worth more than thirty one-off hosts, costs far less to acquire, and turns Aveline from a transaction into infrastructure.

---

## 10. Segments

| Segment | Why they buy | Priority |
|---|---|---|
| **Large events, 100–400 guests** | Coordination pain scales with headcount, and so does our value | Primary |
| **Diaspora events** | Multi-language, multi-timezone, remote guests, higher willingness to pay | Primary |
| **Planners & agencies** | Recurring revenue, multi-event, lowest acquisition cost | Strategic |
| **Corporate** | Repeat events, annual budget, branding requirements | Secondary |
| **Small events** | Volume, low complexity, brand awareness | Volume |

---

## 11. Delivery model

Hosts in this market expect to talk to a person, and that expectation is reasonable. A pure self-serve product would fight it.

**Concierge-first, product-backed.** Hosts still reach us over a messaging app — the familiar intake. Internally our staff work inside the product, and the host receives a login to the operations dashboard for their own event. Staff open the host's organization and event themselves and invite the host as its owner; the host chooses their own password on accepting, so staff never hold it (decided 9 October 2026).

This yields three things at once: a sales motion requiring no behaviour change; our own team as first users, which forces the product to actually work; and a path to self-serve for the low end and for the planner subscription, which is self-serve by nature.

**Turnaround target: same-day first version.** Data-bound templates should make this comfortable, and speed is a visible, comparable claim.

---

## 12. Operational speed and arrangeability

Everything in §6 is worthless if using it is a chore. This is a product
requirement, not a polish item, and most of it is decided in the backend.

### The principle

> **Management and operations must be fast, versatile and easily arranged.
> The shortest path from intent to result, never a multi-step workflow that
> exists because the API was shaped that way.**

A host should be able to move three blocks and switch one off, and have that
be one action. A coordinator opening the operations screen should see numbers,
not five spinners resolving in sequence.

### What this obliges the backend to do

Bad operational UX is usually an API shape problem wearing a frontend costume.
Four rules follow:

| Rule | Why |
|---|---|
| **A screen is one request** | `GET /events/:id/dashboard` returns headcount, catering, bar, playlist and engagement together. Five calls means five spinners, five failure modes, and a screen that renders in waves |
| **A user intent is one request** | Rearranging an invitation is one atomic `PATCH`, not one call per block. A partial failure must not be able to leave the page half-rearranged |
| **The hot path is cached** | One invitation link is opened by every guest, usually within minutes of being sent, and the payload is identical for everyone reading the same language |
| **Order is data, not arithmetic** | The client sends blocks in the order it wants them. It never computes indices, so it cannot compute them wrongly |

### Versatility without complexity

Arrangeability means the host can express what they want, not that they are
given more switches. Concretely:

- **Blocks reorder by array order.** No index fields, no move-up/move-down
  endpoints, no drag state to reconcile.
- **Omitted fields mean "leave as is".** A reorder does not have to restate
  every block's enabled flag and variant.
- **Rejected arrangements change nothing.** Validation runs before any write,
  and the error names the offending block.
- **The template guarantees the result renders.** A host arranging within
  `supportedBlocks` cannot produce a broken page, so the interface can allow
  rather than warn.

### Latency targets

These are commitments, not aspirations. They are what makes the difference
between a tool someone reaches for and one they avoid.

| Surface | Target | Measured (demo event) |
|---|---|---|
| Public invitation page payload | < 50 ms cached, < 200 ms cold | 13 ms / 17 ms |
| RSVP submission | < 300 ms | ~20 ms |
| Operations dashboard | < 500 ms | 6–18 ms |
| Block arrangement | < 300 ms | ~25 ms |

Measured on a small demo event, so these are a floor rather than a guarantee at
400 guests. The point of recording them is that a regression is visible.

A **degraded** store must not break the budget either. With Redis and MongoDB
both stopped, the invitation endpoint serves correct content in ~20 ms and the
dashboard in ~6 ms — see [DATA_STORES.md](../backend/docs/DATA_STORES.md) for the two failures
that had to be fixed to make that true.

Anything CPU-bound — seating computation, exports, image processing — runs as
a job and never inside a request. See [DATA_STORES.md](../backend/docs/DATA_STORES.md).

---

## 13. Public events, announcements and ticketing

Everything above assumes a **closed guest list**: the host knows who is
invited, and each guest reaches a capability link. Public events invert that.
Attendees self-identify, arrive unknown, and capacity is global rather than
per-household.

This is a second product shape on one platform, not a feature bolted onto the
first — but it reuses the whole spine: the same event, venues, timeline,
design system, operations views and payment core.

### 13.1 Visibility

Three states, and the default is the safe one.

| Visibility | Reachable by | Listed | Indexable | Ticketing |
|---|---|---|---|---|
| **PRIVATE** | capability link only | no | never | no |
| **UNLISTED** | anyone with the URL | no | never | yes |
| **PUBLIC** | anyone | yes | opt-in | yes |

A wedding is PRIVATE and must stay so: a page carrying venue addresses,
timings and a guest list has no business in a search index. Indexing is
opt-in even for PUBLIC, and UNLISTED is never indexable whatever its flag
says.

### 13.2 Announcements

An `EventListing` is the public face: translated headline, summary and body,
a hero image, browse categories, and the link-preview metadata.

**Preview metadata matters more than search ranking.** These links are shared
in messaging apps, where the preview is the first thing anyone sees. The API
returns title, description, image, locale, alternates, canonical path and the
robots directive, so the client renders rather than invents them.

### 13.3 Ticketing

| Concept | Purpose |
|---|---|
| **TicketType** | A sellable tier: price, capacity, sales window, per-order limits |
| **TicketOrder** | One purchase. Buyers are not users — a stranger must not need an account, the same reasoning that makes guests capability-based |
| **Ticket** | One admitted person, with an unguessable code |

**Inventory is held before payment, never after.** Charging for a seat that no
longer exists is the worst outcome available, so a checkout reserves first,
pays second, and issues third. Abandoned baskets are swept and returned, or a
popular event sells out to nobody.

**Overselling is a correctness failure, not a tolerable race.** Every
inventory change is a single conditional `UPDATE` whose predicate carries the
invariant, with database `CHECK` constraints as a backstop. Tested with ten
concurrent buyers racing for five seats: exactly five win.

A ticket code admits once. Two scanners at one door cannot both admit it.

### 13.4 Where the two shapes meet

A ticket may link to a `Guest`, which lets seating, catering and check-in
treat ticket holders and invited guests identically. A corporate client can
run an invited-only dinner and a public conference from one account, with one
operations dashboard.

---

## 14. Open decisions

1. **Build order.** Invitation + guest graph + headcount is the minimum coherent product. Seating is the most compelling demonstration but the largest build.
2. **Concierge capacity.** §11 assumes we can staff manual intake at launch.
3. **Planner subscription timing.** Best long-term business, different sales motion and product surface. Early or late?
4. **Agency ambitions.** Own execution and capture the margin, or stay asset-light and coordinate? Biggest fork in this document.
5. **Diaspora.** Launch market or expansion market?
6. **Price points.** §8 is structural only; the numbers are unset.
7. **Vendor supply.** The network module is worthless without partners. Sequencing matters.
8. **Page lifetime.** How long does a published invitation stay live after the event, and at what tier?
