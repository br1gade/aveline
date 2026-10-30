# Data Model

The authoritative map of what is stored and where. 95 PostgreSQL models across three
stores. [PRODUCT_SPEC.md](../../docs/PRODUCT_SPEC.md) §4 explains *why* the core entities
exist; this is the complete inventory.

---

## 1. Where data lives

| Store | Holds | Models |
|---|---|---|
| **PostgreSQL** | The entire domain. The only source of truth | 95 |
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
| `EventInvite` | Bringing someone onto one event with a role; grants nothing in the organization |
| `OrganizationMembership` · `EventMembership` | Standing on an organization / one event |
| `RuntimeCompatibility` | Minimum supported backend reader and explicit additional-membership write gate |
| `OrganizationCreateIntent` | Actor-bound idempotency for additional organization creation |
| `OrganizationAccessReview` | ADMIN-reviewed closure or ownership recovery |
| `OrganizationAccessChange` | Transactional role and departure evidence without contacts or credentials |

### The event
| Model | Purpose |
|---|---|
| `Event` | Root aggregate; carries visibility and locales |
| `Venue` · `VenueProfile` | This event's booking / the reusable directory entry |
| `TimelineEntry` | A moment with a time and a place |
| `EventListing` | The public face of a PUBLIC or UNLISTED event |

Event `(id, organizationId)` is also a unique reference key. Tenant-scoped
child records can reference both values together so an event ID cannot be paired
with a different organization. This adds no event-transfer behavior.

### Invitation and design
| Model | Purpose |
|---|---|
| `DesignTemplate` | Stable shared or organization-private template identity |
| `DesignTemplateVersion` | Immutable published definition, renderer manifest and content hash |
| `TemplateDraft` · `TemplateAssignment` | Revision-checked authoring and explicit SUPPORT assignment |
| `TemplateAudit` · `TemplateReceipt` | Authoring history and actor-bound idempotency receipts |
| `TemplatePreview` | Expiring actor-bound publication or adoption preview |
| `DesignTemplateAsset` · `DesignTemplateStoredObject` | Sanitized private sources and durable object cleanup ledger |
| `DesignTemplateAssetReference` | Ordered draft/version artwork references |
| `TemplateMaterialization` · `InvitationTemplateAsset` | Durable event-copy preparation and exact-version private bindings |
| `Invitation` | Published page; captured first publication, duration/source/plan key, expiry and processed marker |
| `GuestPageVersion` · `GuestPageChange` | Coarse compatibility revision and committed per-event transaction ledger |
| `GuestPayloadVersion` · `GuestPayloadChange` | Independent shared-content and household payload counters; append-only writes, bounded atomic compaction, no parent FKs to preserve domain lock order |
| `InvitationBlock` | One section, ordered, data-bound, toggleable |
| `MediaAsset` | Public invitation uploads, scoped to an event |
| `GuestMedia` | Private raw/derived keys, processing/moderation, reserved bytes and durable deletion tombstones |
| `QuestionStatement` · `GuestAcknowledgement` | Immutable question versions and actual signer/represented subject evidence |

### Staff enquiry intake
| Model | Purpose |
|---|---|
| `SalesEnquiry` · `EnquiryContact` | Assigned internal case and separately redactable contact |
| `EnquiryContactAddress` | Historical address fingerprints for verified subject discovery |
| `EnquiryNote` · `Consultation` | Internal notes and nonoverlapping operator appointments |
| `EnquiryActivity` · `EnquiryCommand` | Revision history and actor-bound command receipts |
| `EnquiryConversion` · `OwnerInviteDelivery` | Explicit draft setup links and privacy-checked owner invitation provenance |
| `EnquiryPrivacyFence` | Serializes subject erasure with intake and conversion writes |
| `EnquiryErasureTombstone` · `EnquiryPrivacyRedaction` | Erasure state and independently journaled recovery checkpoints |
| `DataSubjectRequestEnquirySubject` | Explicitly reviewed contact scope for a privacy request |

### Guest graph — the core asset
| Model | Purpose |
|---|---|
| `Household` | The unit invitations and seating operate on |
| `Guest` | A person, reached by capability token |
| `GuestChannel` | Channel addresses and opt-in evidence for a guest |
| `AttendancePolicy` · `AttendanceResponse` | Versioned attendance modes and person/venue answers; one active policy per event |
| `Rsvp` · `RsvpQuestion` · `RsvpAnswer` | The response, and host-authored questions |
| `GuestImport` | One upload, with per-row errors |
| `SeatingArrangement` | A separately seated venue or the explicit unspecified legacy plan, with a trigger-maintained input revision |
| `Table` · `Seat` | Furniture and one seat per guest per arrangement |
| `SeatRelease` | Decline history retained independently for each arrangement |
| `SeatingJob` | Durable automatic seating intent, lease/attempts, captured attendance/arrangement revisions, applied revision and committed counts/reasons |
| `CheckIn` | Day-of arrival |

### Ticketing
| Model | Purpose |
|---|---|
| `TicketType` | A sellable tier; inventory lives here |
| `TicketOrder` · `TicketOrderItem` | One purchase |
| `OrderAttendee` | One captured attendee per requested ticket, saved at reservation; original answers, explicit household grouping and reconciliation snapshot |
| `Ticket` | One admitted person, uniquely linked to its attendee and guest within the event |
| `PromoCode` | Discounts, percent or fixed |

### Money
| Model | Purpose |
|---|---|
| `Payment` · `PaymentEvent` | A charge, and every state transition with the provider's payload |
| `InvoiceCounter` | Atomic invoice-number sequence per configured series |
| `Refund` | Individual refunds; `Payment.refundedMinor` is the running total |
| `Plan` · `Subscription` · `Invoice` | Recurring billing (PRODUCT_SPEC §9.4). `Plan.invitationLifetimeDays` is how long an invitation stays live — null means indefinitely |

### Vendors and output
| Model | Purpose |
|---|---|
| `Vendor` · `VendorBooking` | The partner network, with scoped brief access |
| `Export` | Legacy live-download audit reference; no historical snapshot |
| `ExportSnapshot` | Durable private CSV/PDF/XLSX job: intent, claims, attempts, provenance, artifact reference, expiry and revocation |
| `ExportArtifact` | Write-ahead private object ledger; survives event deletion, retries and delayed uploads |
| `ExportSnapshotSubject` | Normalized email fingerprints that locate old snapshots during subject erasure |
| `ExportPrivacyFence` | Shared/exclusive capture/erasure fence; repeatable-read conflicts retry |

### Communications
| Model | Purpose |
|---|---|
| `MessageTemplate` | Reusable copy, translated, overridable per organization |
| `Message` | One message — an outbox. Nullable account/sender scope plus provider ref uniquely correlate WhatsApp outcomes. Delivery/read/failure clocks and normalized failure kind/code complement the existing status |
| `EmailSendQuota` | Persistent shared SMTP token bucket and UTC daily budget; survives deploys and Redis eviction |
| `EmailFeedback` | Normalized, idempotent delivery outcomes keyed by an opaque receipt; no address or raw provider payload |
| `WhatsAppReceipt` | Idempotent native status ledger with account/sender/provider reference, outcome, numeric error code and clocks; no contacts/raw payload. Pending seven days, processed thirty days |
| `Suppression` | Who must not be contacted, and why |
| `DeviceToken` | A phone or browser that can receive a push |

### Privacy
| Model | Purpose |
|---|---|
| `DataSubjectRequest` | An export, erasure or rectification request, with its one-month clock |

Guests carry `consentAt` / `consentSource` and `anonymizedAt`; `User` and
`Organization` carry `deletedAt`.

## 3. Decisions worth knowing before changing anything

**Invitation lifetime is captured once.** `firstPublishedAt`, `lifetimeDays`,
`lifetimeSource` (`FREE_DEFAULT`, `PLAN`, `LEGACY`) and `lifetimePlanKey` explain
`expiresAt`. Free fallback is 90 elapsed days after event end/start; a valid
ACTIVE subscription with a future period end captures its plan's
positive days or null for indefinite. Event-date changes recompute finite
captured deadlines; close/reopen and catalogue changes do not reset entitlement.
Existing published history becomes LEGACY with its original deadline (including
null) and no invented publication timestamp. `expiryProcessedAt` is an operational
marker, rearmed when expiry changes; it does not archive or delete data.

**Page revisions commit with domain writes.** Trigger-maintained change rows
have no parent FK to avoid reversed event/household lock acquisition. Bounded
compaction and orphan reclamation run every minute. The version base has an
event FK/cascade. See [DATA_STORES.md](DATA_STORES.md) for cache/read semantics.


**Money is `BigInt` minor units.** Never a float, never a `Decimal` someone can
round. AMD has no subunit: 25,000 dram is `25000`.

**Venue operators are one-to-many.** `VenueProfile.vendorId` is nullable and
indexed, with no uniqueness restriction; `Vendor.venueProfiles` is a collection.
The populated migration drops only the old unique index and adds a lookup
index, preserving profile IDs, operator links and event copies. The staff write
surface accepts only active curated VENUE vendors; public directory reads hide
ineligible legacy links. No new tables were needed for the guest/design batch:
listing image selectors and stable question order were already modelled.

**Translated content is `Json` keyed by locale**, not a translations table. A
join per field, per block, per locale, on the hottest read in the product would
cost more than it buys, and the content belongs to its aggregate.

**Capability tokens, not accounts**, for guests, ticket buyers and vendors —
and only ever stored hashed where they grant account access (`Session`,
`VerificationToken`, `OrganizationInvite`, `EventInvite`).

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
| `seating_arrangements` | One arrangement per venue and one unspecified arrangement per event (partial unique index) |
| `tables` · `seats` | Derived arrangement/event IDs, matching composite foreign keys, arrangement-scoped names and guest seats; unique numbered chairs |
| `seat_releases` | A known table must belong to the release's event and arrangement; a deleted/unknown table remains null without erasing history |
| `ticket_types` | `sold + reserved <= total`; counters never negative |
| `promo_codes` | redemptions within limit; value positive; percent ≤ 100 |
| `refunds` | amount positive |
| `invoices` | amounts never negative |
| `plans` | price never negative |
| `ticket_orders` | discount never negative; request fingerprint binds retries; cancellation marker freezes admission before a refund |
| `order_attendees` · `tickets` | Unique roster position/order, unique attendee/ticket and guest/ticket; composite event FKs plus trigger reject mismatched order/type attendee links |
| `subscriptions` | period end after period start |
| `plans` | an invitation lifetime, when set, is positive — zero would expire a page on publication |
| `device_tokens` | exactly one subject — a user or a guest, never both or neither |
| `data_subject_requests` | the response deadline cannot precede the request |
| `message_templates` | one global template per key and channel (partial index — Postgres treats NULLs as distinct, so the compound unique alone does not bind) |

The multi-venue migration creates arrangements, backfills existing tables/seats
and release markers, then constrains the new columns. Missing venue membership
stays unspecified. Triggers create event/venue arrangements, derive table/seat
write fields and enforce release-table scope, including bulk writes; their `NULL::text` Prisma
defaults are filled before NOT NULL checks. A conflicting explicit field is
rejected. Keep triggers and partial indexes in SQL migrations; Prisma does not
model them. Legacy release columns remain historical input, not current view data.

### Durable automatic seating

`SeatingJob` belongs to its event/arrangement and cascades on their deletion.
A unique requester/event/UUID identifies an accepted intent; a partial unique
index permits only one QUEUED/RUNNING job per arrangement. It stores no guest
names, contacts, capability tokens or reusable permission grant. Results contain
counts and unseated household IDs/sizes/reasons. Current standing is rechecked
before applying; leases and revision guards prevent stale results from writing.
Seat insertion, release dismissal and COMPLETED state commit atomically.

Database triggers advance `SeatingArrangement.revision` for seating and relevant
graph/attendance/venue/policy mutations, including bulk SQL, cancellation and
erasure. They preserve change/undo detection. See
[SEATING_WORKER.md](SEATING_WORKER.md) for bounds and recovery. Frontend adoption,
translated reasons and production recovery/load rehearsal remain open.

## 5. Storage layout

Files go through `StorageService`, never straight to disk or a bucket. Two
adapters sit behind it — Garage (S3) and the local filesystem — selected by
configuration. Keys are generated UUIDs, never the uploaded filename.

Private generated exports are separate: `ExportArtifact` stores internal UUID
keys in a protected bucket/root; `ExportSnapshot` carries provenance, expiry and
revocation. No private export is a public `MediaAsset`.

Full detail, including why reads are anonymous and what durability actually
depends on, is in [STORAGE.md](STORAGE.md).

## 6. Not yet modelled

Deliberate, with the reason.

| Missing | Why it is not here yet |
|---|---|
| `Payout` | `VendorBooking.feeMinor` records what is owed; disbursement needs a banking relationship we do not have |
| `WebhookEndpoint` | No bank has told us it pushes callbacks; we poll. Modelling it now would guess at the shape |
| `VendorAvailability` | The physical-services bridge (BACKEND_GAPS §6) |
| `PrintOrder` | Same |
| `ThankYou` | Post-event flow; the guest graph already holds who to thank |
| Tax rates | Needed for corporate invoicing; `Invoice.taxMinor` holds the amount, nothing computes it |
| Host-data retention policy | Guest expiry is enforced and swept; it deliberately retains host data/media. Any future automatic deletion needs a separately agreed policy |
| Inbound message ingestion | `direction` and `threadKey` are modelled; no provider webhook receives a reply |
| `AuditLog` | Belongs in MongoDB — append-only, never joined |

## 7. Privacy

Erasure **anonymises a guest rather than deleting them**. Deleting cascades to
their RSVP, seat and check-in, which destroys the host's record of
their own event — a record the host has a legitimate interest in keeping.
Nulling the identifying fields removes the person while headcount, seating and
catering totals stay correct.

`Rsvp.dietary` and `dietaryNotes` are **special-category data** under GDPR:
they can reveal health or religion, and so can an answer like "kosher meal".
Erasure clears both, with the rest of what the guest told us; only whether
they came stays (decided 9 October 2026, `privacy/anonymisation.ts`). A
household whose every member is erased is renamed, because "Petrosyan
family" beside an anonymised row names the person again.

Most guest data is supplied by the host, not the guest, which is legitimate
interest rather than consent. `consentSource` records which it was, because
that distinction is what has to be defensible.

`DataSubjectRequest` exists because the obligation has a clock — one month
under Article 12 — and because being able to show when a request arrived and
what was done is the point. An ad-hoc deletion leaves no evidence it happened.

### Not built

Requests are accepted publicly and handled by Aveline staff — export,
erasure, and a manual close for rectification (`privacy/`). What is missing:
`Session.ipAddress` is personal data with no retention limit, and nothing
verifies who is asking before a human marks a request in progress.

Attendance now has an immutable policy identity `(eventId, revision)` and a
response identity `(guestId, revision, scopeId)`. `scopeId` is `event` or the
venue ID, checked against nullable `venueId`. Composite foreign keys enforce
same-event guests, policies and venues; archived policy responses cannot be
changed or moved to another revision. Event mode/revision updates must match
an active policy. Initial policies are created for every event, including bulk
writers. Migration backfills event-wide responses and keeps unknown response
times null. No historical event-wide answer is copied to venues.

`Rsvp.status` is the current person-level projection; dietary/custom fields stay
personal. In per-venue mode it counts a person attending any eligible venue once,
then pending/undecided/declined without guessing unanswered venues. Venue and
timeline edits refresh that projection in the same transaction. Response history
contains no contact details or free text, is included in subject exports, and
retains anonymous operational attendance consistently with existing erasure rules.

Ticket attendee erasure clears the captured roster and reconciliation snapshot
independently of buyer details and invalidates the checkout fingerprint. Issuance
re-reads the roster after claiming the order, so delayed settlement cannot
restore erased data. Existing guest/ticket links are retained for headcounts.

### Organization compatibility records

Organization.accessRevision fences member lifecycle writes. Invitations retain the
accepted user ID for password-proven replay without restoring removed roles.
OrganizationCreateIntent binds actor/key/fingerprint to the created tenant;
OrganizationAccessReview stores minimal ADMIN closure/recovery state without contacts.
RuntimeCompatibility is the shared revision and additional-membership write gate.
The user-only membership unique index remains until an explicit maintenance cutover.

### F39 staff enquiry storage

Additive empty tables `sales_enquiries`, `enquiry_contacts`,
`enquiry_contact_addresses`, `enquiry_notes`, `consultations`,
`enquiry_activities`, `enquiry_commands`, `enquiry_conversions`,
`owner_invite_deliveries`, `enquiry_privacy_fences`,
`enquiry_erasure_tombstones`, `enquiry_privacy_redactions` and
`data_subject_request_enquiry_subjects` hold staff intake independently of
customer membership and financial records. Activity/command metadata contains
IDs and state only; no contact snapshots or note bodies. Receipt intents use a
versioned dedicated HMAC keyring and are permanently spent after redaction.

Database checks enforce contact/redaction/closure/lifecycle shape. Tenant
composite foreign keys prevent event mismatches; deferred linkage checks require
conversion and enquiry targets to agree. Consultation scheduling uses timestamp
with time zone and a GiST exclusion for each operator's scheduled `[start,end)`
interval. Assignment/admin queues, contact exact/prefix lookup, bounded sections,
operator calendars and due cleanup have corresponding indexes. No enquiry
email uniqueness or automatic subject merge exists.

`DataSubjectRequest.subjectEmail` is nullable for manually reviewed staff enquiry
subjects; existing rows remain EMAIL sources and public submission still requires
an email. Reviewed bindings contain contact IDs. Enquiry erasure is applied under
an exclusive intake fence before legacy household/account locks and completes a
request only after its minimal receipts reach the independently preserved signed
journal. Latest closure anchors six UTC calendar months with month-end clamping;
reopen clears the deadline but never restores cleared data. Retention never
creates a global suppression or deletes finance/account records.

Not yet enabled: intake HTTP/conversion rollout, independent production journal
storage acceptance and four-language frontend acceptance. No historical enquiry
rows are inferred during migration.

OrganizationAccessChange is minimal transactional authority evidence: organization,
actor/subject IDs, action, previous/current role, access revision and revoked event
role count. It contains no email, notes, invitation token or message body. Rows
commit with create/join/role change/departure/ADMIN resolution and survive account
soft erasure. Accepted invitation user IDs have nullable SET NULL foreign keys;
legacy accepted rows remain null and cannot become replay credentials.
### Organization compatibility records

Organization.accessRevision fences member lifecycle writes. Invitations retain the
accepted user ID for password-proven replay without restoring removed roles.
OrganizationCreateIntent binds actor/key/fingerprint to the created tenant;
OrganizationAccessReview stores minimal ADMIN closure/recovery state without contacts.
RuntimeCompatibility is the shared revision and additional-membership write gate.
The user-only membership unique index remains until an explicit maintenance cutover.

Staff enquiry requests may additionally store a nullable `verifiedOwnerUserId`
and `ownerAccountVerifiedAt` after separate ADMIN identity verification of an
exact accepted owner reached through PRIMARY_CONTACT provenance. STAFF_ENQUIRY
rows keep null email until that separate proof supplies the real account email.
An equal/shared email does not infer account identity. Reviewed candidate lookup
is cursor-paged and binding batches may append to a larger verified subject set.

`EnquiryPrivacyRedaction.verifiedOwnerUserId` is an optional opaque ID in signed
receipts, allowing old-backup replay to reapply erasure to that specifically
verified account and revoke restored sessions. No account email or identity
evidence enters the external journal. Existing rows need no backfill. Linked
organization/channel/address suppressions are atomically promoted to ERASED,
including an existing hashed unsubscribe; unrelated scopes and ordinary retention
are unaffected.

RuntimeCompatibility.minimumRevision now defaults to 3 for combined F38/F39/F44
readers. Its forward migration raises an existing lower floor without downgrading
a future floor or changing multiOrganizationWrites. Historical migration-only
fixtures retain the original revision-2 state they are intended to verify.
