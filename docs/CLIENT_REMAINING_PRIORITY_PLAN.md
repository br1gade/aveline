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

Plan refreshed against `9827cf5`. Start FR-46 first if one engineer is available. FR-59 can run in parallel from the same baseline. Allow 2–4 backend engineering days for FR-46 and 1–2 for FR-59, excluding frontend work and staging acceptance. Integrate both contracts before generating the final OpenAPI handoff. FR-46 is a pilot gate. FR-59 is needed before the pilot's largest events.

### FR-46 · Gallery upload setting

**Product decisions.** New invitations start with uploads off until the host enables them. Existing invitations keep uploads enabled at migration. Turning uploads off preserves approved photos for invited guests, lets guests remove their own uploads and leaves host moderation available.

**Backend contract.** Use `PATCH /api/v1/events/:eventId/gallery/settings` with `{ "uploadsEnabled": boolean }`. The response returns the saved setting, and the host gallery GET includes it. For an event without an invitation, GET reports uploads off and PATCH returns `404`. The personal invitation response includes `galleryUploadsEnabled`. The setting requires `guest:write`, the existing gallery moderation permission, with current event access checked inside the write transaction. A valid personal link with uploads off receives HTTP `409` and stable code `GALLERY_UPLOADS_DISABLED` on a new upload. Invalid, expired or revoked links still receive their existing refusal.

1. Add an invitation boolean with a migration that backfills existing rows to `true` before applying the `false` default and non-null constraint. Set the default explicitly in `createEventInvitation`, shared by both creation paths. Use the existing invitation change trigger and guest-page revision checks to refresh the personal response after a committed toggle.
2. Take the same event row lock for a toggle and both stages of gallery upload admission. On disable, retire only that event's `STAGING` gallery rows in the same transaction. Use the existing cleanup tombstones so late private writes are still removed. A quick disable/re-enable must not resurrect those uploads. A photo already queued before the disable can finish processing and remains subject to moderation. Private storage I/O stays outside the transaction. Acknowledgement signature uploads follow their existing rules.
3. Verify migrated rows, both invitation creation paths, permission revocation, cross-event and designer refusal, strict boolean validation and warm-cache updates. Pause an upload between reservation and promotion and verify disable, re-enable, stable refusal and cleanup. Verify existing approved photos remain readable and own-photo deletion and host moderation still work.

### FR-59 · Actionable export failure codes

Keep `failureReason` and `recovery` on existing snapshot reads. Classify failures where they occur and use the existing localized recovery response in Armenian, Russian, English and French.

| Failure reason | Worker behavior | Recovery guidance |
|---|---|---|
| `INPUT_LIMIT_EXCEEDED` | End the attempt permanently when capture or the renderer's input bounds reject the data | Explain that the report is too large and route to support or an available smaller export |
| `OUTPUT_LIMIT_EXCEEDED` | End the attempt permanently when output exceeds a file, page or layout bound | Try a smaller export or another supported format where appropriate |
| `ACCESS_REVOKED` | Fail permanently and preserve existing revocation/cleanup when event or contact permission is lost at capture or publish | Request access. Offer a contact-free export only where the report permits it and the user still has export access |
| `STORAGE_UNAVAILABLE` | Use existing bounded automatic retries when private artifact upload fails | Show `WAIT` while queued. Offer retry once a terminal failure is recorded |
| `GENERATION_FAILED` | Keep bounded retries for unexpected failures and the existing fallback for historical rows | Preserve existing recovery behavior |

Update capture and renderer limits to use typed failures without changing the limits. Distinguish a deterministic PDF page cap from the render-time guard. Handle lost leases as ownership outcomes without writing a failure or taking over another attempt's artifact. Preserve the current three-attempt budget, backoff, history, erasure revocation and artifact ledger. Keep report contents and provider errors out of API responses and logs. No database migration is needed for the existing string `failureReason`.

Verify boundary-size cases, localized recovery, retries and exhaustion, access removed before capture and during a staged upload, stale workers, cleanup after a failed publish, and legacy `GENERATION_FAILED` reads. Run the existing CSV/PDF/XLSX coverage and confirm successful exports retain their current response and download behavior.

### Integration and handoff

The backend changes include focused regressions, the shared API and access contract, gallery/export runbooks and generated OpenAPI. Arthur owns the gallery toggle UI and disabled state. Carry `galleryUploadsEnabled` through the personal invitation reader and preserve photo reads and removal. Handle `GALLERY_UPLOADS_DISABLED` if the host turns uploads off while a guest has the page open. The export history should use `failureReason` and localized `recovery`, including removing the unchanged retry action for permanent size or access failures. Run the full local CI gate before promotion and rehearse both flows with Arthur against the same staging release before sign-off.

Paid launch stays on its separate [acceptance track](TODO.md#pp1--paid-launch-readiness-and-invoice-tax-f35). Late-payment reconciliation can be designed separately around the original payment attempt, duplicate-charge prevention and verified bank status. Provider behavior and fiscal invoice implementation depend on the selected bank and approved accounting rules.

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
filters are in place before pagination. FR-46 and FR-59 are implemented in the
backend and await client adoption and staging acceptance. FR-92's listing card
fields are implemented and await client adoption, as are FR-96's translated side
labels and FR-104's brief language. FR-99's input checks are implemented except
(e), the list's 500-entry cap. Payment metadata, staff pagination and access
review context remain open. Frontend adoption follows the handoff for each slice.
