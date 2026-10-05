# Data Model

The authoritative map of what is stored and where. 42 models across three
stores. [PRODUCT_SPEC.md](PRODUCT_SPEC.md) §4 explains *why* the core entities
exist; this is the complete inventory.

---

## 1. Where data lives

| Store | Holds | Models |
|---|---|---|
| **PostgreSQL** | The entire domain. The only source of truth | 42 |
| **Redis** | Cached reads, locks. Rebuildable | — |
| **MongoDB** | Append-only observability | `invitation_events` |

The rule in [DATA_STORES.md](DATA_STORES.md): nothing that must be correct
lives outside Postgres.

## 2. The models

### Identity and tenancy
| Model | Purpose |
|---|---|
| `Organization` | Tenant: a couple, a family, a company, a planner |
| `User` | An account holder |
| `Session` | A refresh token, stored hashed so it can be revoked |
| `VerificationToken` | Password reset and email verification |
| `OrganizationInvite` | Adding a teammate, addressed to an email |
| `OrganizationMembership` · `EventMembership` | Standing on an organization / one event |

### The event
| Model | Purpose |
|---|---|
| `Event` | Root aggregate; carries visibility and locales |
| `Venue` · `VenueProfile` | This event's booking / the reusable directory entry |
| `TimelineEntry` | A moment with a time and a place |
| `EventListing` | The public face of a PUBLIC or UNLISTED event |

### Invitation and design
| Model | Purpose |
|---|---|
| `DesignTemplate` | Fonts, palettes and blocks a template renders correctly |
| `Invitation` | The published page |
| `InvitationBlock` | One section, ordered, data-bound, toggleable |
| `MediaAsset` | Every uploaded or generated file, scoped to an event |

### Guest graph — the core asset
| Model | Purpose |
|---|---|
| `Household` | The unit invitations and seating operate on |
| `Guest` | A person, reached by capability token |
| `Rsvp` · `RsvpQuestion` · `RsvpAnswer` | The response, and host-authored questions |
| `GuestImport` | One upload, with per-row errors |
| `Table` · `Seat` | Furniture, and who sits where |
| `CheckIn` | Day-of arrival |

### Ticketing
| Model | Purpose |
|---|---|
| `TicketType` | A sellable tier; inventory lives here |
| `TicketOrder` · `TicketOrderItem` | One purchase |
| `Ticket` | One admitted person |
| `PromoCode` | Discounts, percent or fixed |

### Money
| Model | Purpose |
|---|---|
| `Payment` · `PaymentEvent` | A charge, and every state transition with the provider's payload |
| `Refund` | Individual refunds; `Payment.refundedMinor` is the running total |
| `Plan` · `Subscription` · `Invoice` | Recurring billing (PRODUCT_SPEC §9.4) |

### Vendors and output
| Model | Purpose |
|---|---|
| `Vendor` · `VendorBooking` | The partner network, with scoped brief access |
| `Export` | A generated document, produced as a job |

### Communications
| Model | Purpose |
|---|---|
| `MessageTemplate` | Reusable copy, translated, overridable per organization |
| `Message` | One message — an outbox. Carries `direction` and `threadKey` so inbound is additive later |
| `Suppression` | Who must not be contacted, and why |
| `DeviceToken` | A phone or browser that can receive a push |

### Privacy
| Model | Purpose |
|---|---|
| `DataSubjectRequest` | An export, erasure or rectification request, with its one-month clock |

Guests carry `consentAt` / `consentSource` and `anonymizedAt`; `User` and
`Organization` carry `deletedAt`.

## 3. Decisions worth knowing before changing anything

**Money is `BigInt` minor units.** Never a float, never a `Decimal` someone can
round. AMD has no subunit: 25,000 dram is `25000`.

**Translated content is `Json` keyed by locale**, not a translations table. A
join per field, per block, per locale, on the hottest read in the product would
cost more than it buys, and the content belongs to its aggregate.

**Capability tokens, not accounts**, for guests, ticket buyers and vendors —
and only ever stored hashed where they grant account access (`Session`,
`VerificationToken`, `OrganizationInvite`).

**Counters are mutated by conditional `UPDATE`**, never read-then-write.
`TicketType` and `PromoCode` both work this way.

**Captured-at-purchase amounts.** `TicketOrderItem.unitPriceMinor`,
`TicketOrder.discountMinor` and `Invoice.lines` all snapshot their value, so a
later price or template change never rewrites history.

## 4. Invariants the database enforces

Application code enforces these too; the constraints exist so a future code
path that forgets cannot breach them. Each was verified by watching Postgres
reject the bad row.

| Table | Constraint |
|---|---|
| `ticket_types` | `sold + reserved <= total`; counters never negative |
| `promo_codes` | redemptions within limit; value positive; percent ≤ 100 |
| `refunds` | amount positive |
| `invoices` | amounts never negative |
| `plans` | price never negative |
| `ticket_orders` | discount never negative |
| `subscriptions` | period end after period start |
| `device_tokens` | exactly one subject — a user or a guest, never both or neither |
| `data_subject_requests` | the response deadline cannot precede the request |
| `message_templates` | one global template per key and channel (partial index — Postgres treats NULLs as distinct, so the compound unique alone does not bind) |

## 5. Storage layout

Files go through `StorageService`, never straight to disk or a bucket. Two
adapters sit behind it — Garage (S3) and the local filesystem — selected by
configuration. Keys are generated UUIDs, never the uploaded filename.

Full detail, including why reads are anonymous and what durability actually
depends on, is in [STORAGE.md](STORAGE.md).

## 6. Not yet modelled

Deliberate, with the reason.

| Missing | Why it is not here yet |
|---|---|
| `Payout` | `VendorBooking.feeAmount` records what is owed; disbursement needs a banking relationship we do not have |
| `WebhookEndpoint` | No bank has told us it pushes callbacks; we poll. Modelling it now would guess at the shape |
| `VendorAvailability` | The physical-services bridge (BACKEND_GAPS §6) |
| `PrintOrder` | Same |
| `ThankYou` | Post-event flow; the guest graph already holds who to thank |
| Tax rates | Needed for corporate invoicing; `Invoice.taxMinor` holds the amount, nothing computes it |
| Retention sweep | `Invitation.expiresAt` exists but nothing sets or sweeps it, so pages live forever and storage is never reclaimed (PRODUCT_SPEC §14) |
| Inbound message ingestion | `direction` and `threadKey` are modelled; no provider webhook receives a reply |
| `AuditLog` | Belongs in MongoDB — append-only, never joined |

## 7. Privacy

Erasure **anonymises a guest rather than deleting them**. Deleting cascades to
their RSVP, seat, ticket and check-in, which destroys the host's record of
their own event — a record the host has a legitimate interest in keeping.
Nulling the identifying fields removes the person while headcount, seating and
catering totals stay correct.

`Rsvp.dietary` and `dietaryNotes` are **special-category data** under GDPR:
they can reveal health or religion. An erasure must clear them even though
they read as operational.

Most guest data is supplied by the host, not the guest, which is legitimate
interest rather than consent. `consentSource` records which it was, because
that distinction is what has to be defensible.

`DataSubjectRequest` exists because the obligation has a clock — one month
under Article 12 — and because being able to show when a request arrived and
what was done is the point. An ad-hoc deletion leaves no evidence it happened.

### Not built

The models and columns exist; the behaviour does not. No endpoint accepts a
request, nothing performs an anonymisation, and nothing assembles an export.
`Session.ipAddress` is personal data with no retention limit.
