# Larger frontend requests — implementation plan

Planning baseline: `main` at `e031560`. Product decisions confirmed on 8 November 2026. The backend and release wiring are implemented on `codex/client-larger-requests`. The live contracts are in [API.md](API.md) and generated OpenAPI. The frontend and staged rollout are tracked below.

## Delivery order

| Track | Backend or platform estimate | Dependency |
|---|---:|---|
| FR-11 · Same-origin deployment | 3–5 engineering days | Web image and runtime inputs from Arthur. Staging needs hostname, DNS, TLS and environment configuration. |
| FR-79 · Door roster | 2–4 engineering days | Existing admission and event access rules. Arthur can build against agreed fixtures while the backend work runs. |
| FR-115 · Private artwork | 2–4 engineering days | Coordinate the compatible client reader and removal of legacy response paths. |
| FR-128 · Privacy export recovery | 3–5 engineering days | Existing privacy workflow and staff access. Client delivery confirmation follows the new contract. |
| FR-135 · Scheduled Free plan | 4–7 engineering days | Existing subscription, invoice and settlement state. Client plan controls follow the new contract. |
| Real-backend rehearsal | 3–6 joint engineering days | Start locally now. Staging evidence depends on FR-11 and the client/backend slices being exercised. |

FR-11 and FR-79 are the pilot priorities. The three launch tracks can proceed independently of them and of each other. These are rough estimates for engineering and verification, excluding client implementation, infrastructure lead times and defects found during rehearsal.

## FR-11 · One public app origin

Serve the website and `/api` from one HTTPS origin. Private media keeps its existing separate origin.

1. Add the frontend image to the production Compose stack. Route the existing versioned API prefix to the API service and web requests to the frontend through Caddy. Keep the frontend server's API calls on the Compose network, and keep API and web upstream ports private. Retain deliberately exposed health and media routes and verify that internal routes cannot be reached through either public origin.
2. Align the web build’s `VITE_PUBLIC_ORIGIN`, backend `PUBLIC_APP_URL` and `CORS_ORIGINS` with the canonical origin. Generate links and return URLs from that origin and set the web server’s `API_INTERNAL_URL` to the private API upstream. Use relative API calls from the browser. Verify the proxy trust chain, origin enforcement, private caching and capability-path redaction. Review existing callers and configured callbacks before retiring or redirecting any legacy API hostname.
3. Extend the existing release manifest, image verification, deployment health checks and rollback to cover the frontend image. Rehearse routing and rollback with the actual release jobs. Confirm schema compatibility before relying on rollback of a previous image.

Acceptance includes browser sign-in and refresh, invitation and order links opened in a fresh tab, SSR, a simulated payment return, configured provider callback routing, private media, rejected cross-origin requests and log/cache inspection. Record a staging deployment and rollback against the [release runbook](../backend/docs/RELEASES.md).

## FR-79 · Door roster

Use existing event permissions for the pilot. Apply the existing guest-read policy to the roster and preserve the current admission write policy and arrival aggregate policy. Validate the resulting role matrix before exposing seating labels. Apply existing seating visibility rules to those labels.

- Add a searchable, cursor-paginated door projection. Include the guest ID, display name, minimal household grouping where present, visible seat or table label, attendance state, arrival timestamp and a ticket indicator when relevant. Omit contact details, capability links, ticket codes and unrelated guest profile data. Household grouping is optional. A ticket holder can use the established ticket flow without a household association.
- Use bounded page and search sizes, stable ordering with an ID tie-breaker, database projection and index-backed lookups. Support the name matching behavior used at the door. Use private, no-store responses. Search and refresh are sufficient for the first release.
- Keep the existing admission endpoints and their FR-76 refusal facts. Refresh the affected roster entry after an admission or repeated scan. Verify tenant isolation, the permission matrix, a large roster, four-language search and labels, and simultaneous check-ins. Exercise named and unlinked ticket holders and invitations with no assigned seat.

## FR-115 · Private invitation artwork

- Return typed asset references with asset IDs for private artwork in personalized invitation content, including covers and applicable legacy designs. Keep public media distinguishable from a private asset reference. Resolve private bytes through the existing scoped file access, with the same guest, event, version and asset checks and private cache controls.
- Agree the reference shape first. Arthur ships a reader compatible with both forms, including SSR. Then switch the personalized response to asset IDs and remove legacy credential-bearing paths after the compatibility check. Public-facing social metadata must exclude private artwork and private asset references.
- Verify older published invitations, replacement and removed assets, covers and inline artwork, public media, cross-event denial, expired credentials, and URLs or data exposed to browser logs, analytics, response bodies and caches.

## FR-128 · Recoverable privacy exports

Regenerate from current data until authorized staff confirm delivery. Keep generation and delivery metadata, with no retained copy of the export.

- Reuse existing privacy authorization, identity verification and request locking. A verified export remains open after generation, including after a lost response. Record an opaque generation ID, actor and time on success. Generate with the existing privacy locks and consistent data reads so a later retry reflects intervening data changes or erasure. Keep export contents out of durable storage, audit, logs and caches.
- Add explicit delivery confirmation tied to the latest successful generation. Reject confirmation before generation or for a superseded generation. Make a repeat confirmation for the completed generation safe to retry. Completion stops regeneration. Historical completed requests remain closed.
- Test a lost response, regeneration after data changes and erasure, unauthorized access, two staff acting concurrently, stale confirmation and retry after confirmation. The staff screen should distinguish generating, ready for delivery and delivered. A browser download by itself leaves the request open.

## FR-135 / FR-110 · Scheduled switch to Free

The paid plan stays active through its paid period. The owner can withdraw the switch before the boundary. Automatic renewal requires separate consent. A different paid checkout supersedes the schedule only once its payment is confirmed.

- Persist the pending Free change with the target plan version and effective time. Expose the pending state and date for the client. Reuse organization-level billing serialization for scheduling, withdrawal, cancellation and resumption, due changes, settlement and refunds. Withdrawal keeps the current paid period without re-enabling renewal.
- Apply the due change atomically and safely on retries. Reconcile due changes on entitlement reads and writes as appropriate so worker delay cannot extend paid access. Preserve captured invitation lifetimes and historical billing records.
- Selecting Free voids a pre-existing unpaid plan-change invoice under the current policy. A late capture on that invoice follows the existing full-refund path. Model a later replacement checkout separately. Starting, abandoning or failing that checkout leaves the Free change scheduled. A confirmed payment under a still-valid checkout can activate the new plan through existing settlement rules, including after Free has taken effect. Use the existing refund or review path for a late payment on a voided or superseded checkout.
- Test just before and at the period boundary, withdrawal racing the worker, repeated jobs, catalogue updates, failure or payment on either side of the boundary, explicit cancellation or resumption, and late payment on an invalidated checkout. Verify current and scheduled plan labels and effective dates with the client.

## Real-backend rehearsal

Run against the combined client and API on disposable data first, then against the same-origin staging release. Cover host setup and publish, guest invitations and RSVP, door admission and repeated scans, ticket purchase and order retrieval, private artwork, privacy export delivery and signed-out privacy intake from the localized invitation footer, and the scheduled billing change. Run desktop and mobile journeys across Armenian, Russian, English and French. Use the test provider for payment and test recipients for mail. Keep evidence by release commit and browser with no personal data or capability links. Record launch evidence against [GOING_LIVE.md](GOING_LIVE.md).

## Arthur’s frontend handoff

- **FR-11** · Deploy the client with relative browser API calls. The release uses the existing frontend Dockerfile with `VITE_PUBLIC_ORIGIN`, `VITE_MEDIA_BASE_URL` and an empty `VITE_API_BASE_URL`. Verify SSR, deep links, sign-in, mail and the test payment return on staging. Staging and production each need a build for their own origin pair.
- **FR-79** · Use `GET /events/:eventId/door-roster` with `search`, `limit` and `cursor`. Follow `nextCursor` using the same search. Replace the full guest graph on the door screen, preserve arrival totals and the FR-76 refusals, and refresh after check-in.
- **FR-115** · Use `?artwork=asset-id` on the personal invitation endpoint. `coverUrl` and private block media `url` can carry `{kind:"private-design-asset",assetId}`. Resolve through the existing scoped file endpoint. Keep the legacy reader while rollout is in progress. Switch the default and remove legacy credential-bearing paths only after the client is verified.
- **FR-128** · Reuse fulfil to regenerate. Confirm verified delivery with `POST /privacy/requests/:requestId/confirm-delivery` and the latest `generationId`. Keep the case open after download and refresh the case state on a stale-generation conflict.
- **FR-135** · Show the current plan and `pendingFree` with its effective date. Withdraw via `DELETE /subscription/pending-free`. An unpaid replacement checkout leaves the switch scheduled.

Regenerate frontend API types from the combined commit and run the relevant real-backend journeys for each delivered slice.

## Local verification

Backend verification covered 1,654 unit tests, 937 integration tests and
1,399 HTTP tests across isolated runs. The privacy HTTP suites were rerun
after updating their delivery-confirmation expectations. The generated
OpenAPI, docs, workflow lint and operations tests also passed.

The Compose rehearsal exercised Caddy, SSR, migration, worker readiness,
redeployment and backup capture. The edge regression verified TLS routing,
media separation, credential redaction and the renderer's framing and referrer
headers. Chromium signed in and submitted the signed-out privacy form against
the combined stack. Mobile privacy pages negotiated Armenian, Russian, English
and French. The unchanged frontend generated types and passed all 4,191 tests
against the updated API sources in a disposable checkout.

## Still to roll out and verify

The frontend adoption, artwork default cutover and wider browser rehearsal are
open. Same-origin configuration and local deployment can be verified with
the disposable Compose rehearsal. Staging needs configured origins, DNS,
TLS, SMTP and the attested release. Real paid launch depends on the separate
bank and fiscal gates in the launch checklist.
