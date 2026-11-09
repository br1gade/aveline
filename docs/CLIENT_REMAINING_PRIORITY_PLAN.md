# Frontend requests beyond the first handoff

Implementation plan against `88c85d4`, based on the [frontend register](../frontend/docs/BACKEND_REQUESTS.md) and [design decisions](../frontend/docs/design/DESIGN_DECISIONS.md). This covers the additional requests verified in the audit. The broader register still needs a separate reconciliation. Proposed changes are marked in the status below. The implemented contract is in [API.md](API.md) and the generated OpenAPI document.

## Order and parallel work

| Workstream | Requests | Rough backend effort | Dependency |
|---|---|---:|---|
| Guest credentials and contact preferences | BQ-11, FR-99 | 4–7 days | Start the suppression invariant first. The Telegram cutover uses the same suppression logic and follows that fix. |
| Pilot host controls | FR-46, FR-59 | 3–6 days | Gallery and export changes are independent. |
| Localized invitation and brief data | FR-96, FR-104 | 2–4 days | The brief can declare its current locale independently. If it also includes side labels, reuse the FR-96 resolver. |
| Public listing and payment availability | FR-92, FR-64, FR-109 | 2–4 days | Listing summaries are independent. Checkout and plans share one payment availability calculation. |
| Staff queues and scanner contract | FR-127, FR-129, FR-132, FR-133 | 3–5 days | Land concierge eligibility filters before defining its cursor. Access reviews, the privacy queue and scanner documentation can run independently. |

Effort excludes frontend implementation, staging setup and provider acceptance. Start the credentials and contact-preference work first. The other workstreams can proceed in parallel from the same baseline. Split reviews by workstream and coordinate migration ordering and OpenAPI generation at integration.

## 1. Protect guest credentials and contact preferences

**FR-99 · Suppression precedence.** Use one reason ordering for global and organization-scoped writes. Enforce it atomically at the database write so concurrent requests cannot downgrade a stronger reason or replace its notes with a weaker write. Keep the existing normalization, scope and authorized removal rules. Inspect all callers before changing which reasons an operator may submit. Retain the existing input contract for the precedence fix and document any later tightening separately. In the Telegram path, an explicit opt-in may clear only the reversible Telegram block it is meant to undo. Preserve erasure, complaint and unrelated organization restrictions. Verify same-reason retries, stronger then weaker and weaker then stronger writes, concurrent requests, and tenant isolation.

**BQ-11 · Separate Telegram opt-in from invitation access.** Issue a high-entropy, single-purpose code when queuing an eligible invitation email. Store its digest and minimal redemption metadata. Scope it to one guest, invitation and bot, and check current guest access at redemption, including publication, expiry, erasure and credential rotation. The first implementation uses a 30-day lifetime capped by invitation expiry. Each eligible invitation email gets a fresh code under the existing send and retry rules. Its code metadata is written with the outbox row.

Validate the authenticated webhook and private chat before claiming the code. Redeem and link in one transaction. Duplicate delivery from the same chat is harmless. A different chat cannot reuse a redeemed code. Keep raw codes and chat addresses out of application diagnostics. Preserve active Telegram subscriptions. Retain the personal page's nullable `telegramLink` field during compatibility rollout and return null in line with C-26. Telegram codes must never authorize invitation, RSVP or asset reads.

At cutover, invitation tokens cease to work as Telegram payloads. Dispatch removes old Telegram start URLs from queued legacy invitation emails. Already delivered legacy bot links will stop opting guests in, and the ordinary invitation links stay valid. Verify resend, old-code refusal, wrong webhook secret or bot/chat scope, replay races, rotation, expiry, erasure, and re-opt-in with stronger suppressions present. Verify delivery using a staging bot before enabling the new links live.

## 2. Pilot host controls

**FR-46 · Gallery upload setting.** Confirmed 8 November 2026. New invitations start with uploads off until the host enables them. Existing invitations retain their upload behavior. Write the default through the shared invitation creation path. Add a host setting under existing invitation permissions and return the effective setting to the personal page. Preserve existing photos and moderation when uploads are switched off. Serialize the toggle and upload admission, and recheck a staged upload before promotion when a disable races with it. Clean up any staged bytes that lose that race. Use the existing invitation revision mechanism so stale cached pages cannot advertise a changed setting indefinitely. Verify both creation paths, legacy invitations, enable and disable, wrong event or role, concurrent uploads, and private-media cleanup.

**FR-59 · Actionable export failure codes.** Distinguish input and output limits, access revoked, storage unavailable and unexpected generation failure at the point each occurs. Publish stable codes and recovery actions. A revoked lease remains a worker ownership outcome. Preserve existing retry, lease, revocation and artifact-cleanup behavior, and keep report content out of errors and logs. Old `GENERATION_FAILED` records retain their fallback behavior. Verify a permanent size failure, a retryable storage failure, contact permission removed before capture or publish, and a stale worker that loses its lease.

## 3. Localized invitation and brief data

**FR-96 · Translated side labels.** Extend existing event wording and locale validation with per-language side labels. Keep event-level labels as fallback for legacy records and incomplete translations. Use the negotiated invitation locale for guest-facing labels, and review existing share, notice and read projections for consistent fallback. Leave side IDs and stored RSVP answers stable. Verify locale fallback, clears and omitted fields, updates to published invitations and cached reads in Armenian, Russian, English and French.

**FR-104 · Declare vendor brief language.** C-45 keeps the event's default language. Return the effective `locale` and keep the existing brief scope and snapshot rules. Use the same locale for event and venue wording and any side labels included in the brief, with stored text as fallback. The vendor's browser language can still drive the page chrome. Verify localized content and fallback, and keep the owner's decisions to hide unpublished seating and allow pausing access without ending a booking.

## 4. Public listing and payment availability

**FR-92 · Listing card fields.** Add `timezone`, the negotiated `locale` and nullable `endsAt` to the existing summary projection. Preserve listing visibility and pagination. Verify no extra per-card reads, mixed event locales, missing end times and schedule formatting across time zones.

**FR-64 and FR-109 · Payment availability.** Derive a common safe projection from the existing pilot charge guard and configured provider registry. Keep the current plan list response shape and expose shared availability metadata for pricing and checkout. Report the effective paid-charge state and selectable providers without exposing credentials or making a claim about bank health. Keep test providers out of production public responses. A free order, including one made free by a valid discount, retains its current path. Paid offers remain visible in the pilot per C-47. Verify pilot on/off, no configured gateway, one or several configured gateways, a free order and a paid attempt refused by the charge guard. Real card acceptance still needs the chosen bank and staging credentials.

## 5. Staff queues and scanner contract

- **FR-127 and FR-132 · Concierge and privacy queues.** Exclude closed organizations and expired or revoked owner invitations from concierge results and reuse the existing organization eligibility rules where their scope matches. Preserve existing array readers during rollout and add paginated staff reads with bounded page sizes, deterministic ordering, and an explicit open-privacy queue. Order open requests by due date and ID. Order closed queues so recent cases can be reached. Preserve staff permissions, search redaction and the distinction between owner and live owner invitation. Verify mixed statuses and due dates, cursor boundaries, stale invites, and active versus closed organization scope.
- **FR-133 · Access review context.** Return organization name and kind in the existing admin list with a projected database join. Keep pagination, staff authorization and revision checks. Document the review reasons and give stale reviews a review-specific conflict description. Verify the page stays bounded and does not need a follow-up request per row.
- **FR-129 · Ticket QR contract.** Document the format the current issuer and scanner already use, including case and allowed characters. Tie contract verification to those existing implementations. Keep issued tickets valid. Verify that a guest invitation URL, arbitrary QR text and malformed ticket code are rejected before any admission call.

## Arthur’s handoff and release acceptance

For the first slice, keep the Telegram opt-in button absent from the guest page. The personal response retains `telegramLink` with a `null` value. Guests use the opt-in link in an eligible invitation email. The door scanner already accepts the documented 16-character ticket code. Concierge search keeps the same response shape and only returns eligible organizations. Keep the distinction between an existing owner and a live owner invitation.

Share the proposed DTOs before implementation and regenerate types from the combined commit. Arthur owns the gallery controls and disabled state, export recovery UI, localized side labels and brief language handling, listing cards, payment availability messages, and staff queue adoption. Arthur should update the vendor brief notes to reflect the owner's direct decisions to hide unpublished seating and permit pausing. The door continues to use existing event roles during the pilot.

Run focused regressions per slice, then the full backend gate and local CI on the integrated commit. Rehearse the changed screens with real API responses, including the privacy/staff and ticketing paths. Native copy review, designer approval, replacement imagery, legal review of the privacy copy, and production support contacts remain separate launch acceptance items. Real Telegram and card verification use staging providers.

## Still to implement

FR-99 precedence and BQ-11 are implemented in the first backend slice. The
Telegram rollout still needs a staging bot and provider rehearsal. FR-129's
existing ticket code format is documented. FR-132's concierge eligibility
filters are in place before pagination. Gallery controls, export codes, locale
changes, public listing and payment metadata, staff pagination and access
review context remain open. Frontend adoption follows the
handoff for each slice.
