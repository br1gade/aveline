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

| Entity | Purpose | Key relationships |
|---|---|---|
| **Organization** | Tenant. A couple, a family, a company, or a planner | has Events, Memberships |
| **User** | An account holder. Carries a platform role for Aveline staff | has Organization and Event memberships |
| **OrganizationMembership** | A user's standing in a customer organization | links User and Organization |
| **EventMembership** | Access to one event, e.g. a coordinator or a designer | links User and Event |
| **Event** | The root aggregate | has Venues, Guests, Invitation, Timeline, Tables |
| **EventType** | wedding, engagement, baptism, birthday, anniversary, corporate, other | classifies Event |
| **VenueProfile** | A reusable venue in the directory, shared across events | may link to a Vendor; has Venues |
| **Venue** | This event's use of a place: ceremony, reception, after-party | belongs to Event, may reference VenueProfile |
| **TimelineEntry** | A moment with a time and a place | belongs to Event, references Venue |
| **DesignTemplate** | Declares the fonts, palettes and blocks a template renders | has Invitations |
| **Invitation** | The published page: template, theme, language set, status | belongs to Event and DesignTemplate |
| **InvitationBlock** | One section, ordered, data-bound, toggleable, with a layout variant | belongs to Invitation |
| **MediaAsset** | An uploaded image, signature or audio file, scoped to an event | belongs to Event |
| **Household** | A group invited together; the unit plus-ones attach to | belongs to Event, has Guests |
| **Guest** | A person. Reaches their invitation by capability token | belongs to Household, has one Rsvp |
| **GuestAttribution** | Which host's side the guest belongs to | on Guest |
| **Rsvp** | A guest's response, including a captured signature | belongs to Guest, has RsvpAnswers |
| **RsvpQuestion** | A configurable question on the invitation | belongs to Invitation |
| **RsvpAnswer** | One answer to one question | links Rsvp and RsvpQuestion |
| **Table** | A seating table in a venue, with a capacity and zone | belongs to Event and Venue, has Seats |
| **Seat** | A guest's assigned place at a table | links Table and Guest |
| **Vendor** | A service provider in the network | linked to Events via VendorBooking |
| **VendorBooking** | A vendor engaged for an event, with scoped brief access | links Vendor and Event |
| **CheckIn** | A guest's day-of arrival | belongs to Guest |

Access control — who may do what, and how guests and vendors reach the system
without accounts — is specified in [ACCESS_CONTROL.md](ACCESS_CONTROL.md).
Venues and seating are detailed in [VENUES_AND_SEATING.md](VENUES_AND_SEATING.md),
the design system in [INVITATION_DESIGN.md](INVITATION_DESIGN.md).

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

Entry pricing sits at the premium end of the single-artifact band, because we are not selling that artifact. The Managed tier is priced against **the planner's time saved**, not against the cost of printing. Specific price points are open (§12).

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

**Concierge-first, product-backed.** Hosts still reach us over a messaging app — the familiar intake. Internally our staff work inside the product, and the host receives a login to the operations dashboard for their own event.

This yields three things at once: a sales motion requiring no behaviour change; our own team as first users, which forces the product to actually work; and a path to self-serve for the low end and for the planner subscription, which is self-serve by nature.

**Turnaround target: same-day first version.** Data-bound templates should make this comfortable, and speed is a visible, comparable claim.

---

## 12. Open decisions

1. **Build order.** Invitation + guest graph + headcount is the minimum coherent product. Seating is the most compelling demonstration but the largest build.
2. **Concierge capacity.** §11 assumes we can staff manual intake at launch.
3. **Planner subscription timing.** Best long-term business, different sales motion and product surface. Early or late?
4. **Agency ambitions.** Own execution and capture the margin, or stay asset-light and coordinate? Biggest fork in this document.
5. **Diaspora.** Launch market or expansion market?
6. **Price points.** §8 is structural only; the numbers are unset.
7. **Vendor supply.** The network module is worthless without partners. Sequencing matters.
8. **Page lifetime.** How long does a published invitation stay live after the event, and at what tier?
