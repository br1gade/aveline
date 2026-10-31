# Going Live

> **Status: under local development. Not live, no production deployment, no
> real users, no real money.** Everything runs on one developer machine
> against local containers.

This is what has to be true before that changes. Nothing here is a
nice-to-have — each item is either a way to lose money, lose data, or lose a
customer's trust.

Use [TODO.md](TODO.md) for the remaining pilot tasks, required inputs, owners and
proposed post-pilot batches. This document remains the release requirements checklist.

---

## 1. Blocking — cannot go live without these

### Code

Every open **P0 bugfix** and **P0 feature** in [BACKLOG.md](BACKLOG.md).
The original remaining P0 feature is the client. The user has also made the
expanded [implementation plan](PILOT_IMPLEMENTATION_PLAN.md) a release gate:
17 requested feature items, including all export formats, both attendance modes
and explicit reconfirmation when changing modes, multiple directory venues per
vendor, gallery, acknowledgements and final rehearsal. Native F22 is the one
explicit exception. Repeat the complete host/guest walkthrough in English, Russian,
French and Armenian after frontend integration. The tentative 25 October 2026
date can move; full scope takes priority.

The 24 October disposable backend rehearsal passed functional workflows, real
worker lease recovery and local privacy cleanup. The latest isolated load run passes
all eight local latency gates. Actual-host performance acceptance, required
human review of export/recovery-message translations and external/frontend acceptance still
block this pilot; see [local evidence](../backend/docs/PILOT_REHEARSAL.md).

**The client is partial and unmerged.** It lives on `frontend/guest-invitation`
and `frontend/publish-send`, not on `main` or `dev`. As of 29 October 2026 it
covers accounts, events, venues, the guest list and import, the invitation
designer, publishing, sending and the guest reply. Seating, the door
(check-in), exports, tickets and checkout, billing, the event team,
acknowledgements, the gallery and archiving have no screens yet. The client's
own "not yet built" list is its `frontend/docs/ARCHITECTURE.md` §12.

Backend items the client team raised that still hold (IDs are in its
`frontend/docs/BACKEND_REQUESTS.md`). FR-7, FR-27, and the schema, privacy and
validation items answered on 31 October 2026 are listed in
[TODO.md](TODO.md) T1:

| Item | Why it blocks |
|---|---|
| **FR-11** No web service in `docker-compose.prod.yml`; Caddy serves only `API_DOMAIN` | The client has nowhere to run in production, and one-origin vs. separate-origin (CORS, `PUBLIC_APP_URL`, payment `returnUrl`) is not agreed |

### Money

| # | Blocker | Why |
|---|---|---|
| 1 | **No bank merchant account** | Ameriabank, Inecobank and IDBank each need a business account and, in practice, a visit. Nothing can be charged until one exists |
| 2 | **No adapter has run against a real sandbox** | The three gateways are written against published integrations and their field names are our best reading. They must be checked against the spec each bank sends |
| 3 | **Ameriabank certification not done** | Requires at least five successful completed REST payments in their test environment before production access is granted |
| 4 | **One-step vs two-step not decided** | Deposits probably want authorize-then-capture, which must be requested from the bank separately |
| 4b | **Three suspected field mismatches** | Ameriabank's `OrderID` may need to be an integer; ArCa may expect AMD in luma (× 100); Ameriabank's `OrderStatus` is read with ArCa's codes. Each must be confirmed against the bank's own specification — see PAYMENTS.md §6 |
| 4c | **The bank's order lifetime is not tied to ours** | We expire an unpaid order after an hour, but `registerOrder` sends the bank no session timeout, so its form may stay payable longer. A payment the bank captures after we wrote it off is never asked about again (`EXPIRED` is final), and a retried paid subscribe now starts a fresh payment for the invoice — two charges for one invoice. Send the bank a lifetime no longer than `ORDER_LIFETIME_MS`, or keep asking about recently expired orders |
| 5 | **Refunds never executed for real** | The claim-then-call ordering is tested against a fake gateway. It has never moved actual money |

### Communication

| # | Blocker | Why |
|---|---|---|
| 6 | **A sending domain and its DNS** | Email is implemented over SMTP and refuses to boot in production without it, but no mail account, sending domain or SPF/DKIM/DMARC records exist. Without them mail is sent and then filed as spam, which looks like delivery and is not |
| 7 | **Real delivery feedback is not connected** | Persistent quotas and signed provider-neutral delivery/bounce/complaint handling are built. A native provider bridge is deferred by the user; sending, authentication and internal message correlation must still be proven against the chosen provider |

### Security and data

| # | Blocker | Why |
|---|---|---|
| 8 | **`JWT_SECRET` must be real** | The app refuses to boot in production without it, which is the guard — but it must be generated, stored in a secret manager, and rotatable |
| 9 | **`CORS_ORIGINS` must be set** | Also enforced at boot. An open CORS policy lets any site call the API with a user's credentials |
| 9b | **`PUBLIC_APP_URL` must be the client's real origin** | Enforced at boot. Guest links, account emails and the bank's return page are all built from it, and a payment `returnUrl` on any other origin is refused — so a wrong value breaks checkout rather than opening a redirect |
| 10 | **A verified off-host recovery destination** | Quiesced paired database/media capture, encrypted Restic upload and complete restoration tooling are built. An isolated round trip preserved a guest credential and original/variant media. Configure a real separate destination, install the timer/boot recovery units, verify remote restoration and missed-backup alerts |
| 11 | **A host and a domain** | The Docker/Compose profile wizard and release/promotion jobs are implemented. Local stack/worker/migration/backup rehearsals exist. Provision a real host, API/media DNS, public TLS and SMTP; configure GitHub environments, reviewers and verified SSH. See [release setup](../backend/docs/RELEASES.md). No live deployment has been performed |
| 12b | **An SMS provider** | The channel is built and inert. Choose a provider that reaches Armenian numbers, write its adapter (one class), and set `SMS_PROVIDER`. Until then guests with only a phone number are reported unreachable |
| 12 | **WhatsApp account and live acceptance** | Transport and signed/scoped receipt backend are built; no account/test number exists yet. Verify account/number/permissions, supported API version, approved four-language templates/consent, real subscription and send/receipt evidence using the [setup checklist](../backend/docs/WHATSAPP_SETUP.md). External approval can move the pilot date |
| 13 | **GDPR identity verification is manual** | Requests are accepted, tracked against the one-month clock, and carried out — erasure anonymises, export assembles. But nothing verifies who is asking, so a human must do it before pressing fulfil, and nothing alerts on the clock running down |

### Operations

| # | Blocker | Why |
|---|---|---|
| 14 | **Zero-downtime deploys** | The controller deliberately stops all writers for migration and quiesced capture. Schedule maintenance away from check-in; failover and zero-downtime rollout are not built |
| 15 | **Single-node everything** | Postgres, Redis, Mongo and Garage all run one instance with no failover. Replication factor is 1 |
| 16 | **Two dependency advisories accepted, not fixed** | Both reached only through code a request cannot touch — a Prisma config file we own, and Swagger, which is disabled in production. Each is fixed by a migration named in `backend/docs/DEPENDENCIES.md`: Prisma 7 needs a driver adapter, and NestJS 12 needs ESM |
| 17 | **No `SENTRY_DSN` configured** | Error reporting is wired and inert |
| 18 | **Migrations never run against production data** | Every migration is written to be backfill-safe, and none has been tested against a database with real volume |

---

## 2. Should be true, but would not stop a launch

| Item | Note |
|---|---|
| Orphan reclamation | Nothing deletes assets when an event is archived; usage only grows |
| Invitation expiry | Backend captures free 90 days after event end/start or plan lifetime; live guest checks and bounded monitored sweep built. Verify frontend expiry states, legacy review and actual-host sweep operation |
| CDN | Garage serves media directly |
| Shared rate limits | Limits are per account or per address, but counted in each instance's memory: a second API instance doubles them. `POST /privacy/requests` has only the general public limit |
| Asynchronous bounce reports | Signed provider-neutral delivery/bounce/complaint ingestion is built. Native provider/mailbox integration stays deferred by D30; it is not connected to real delivery events |
| Provider send-rate throttling | Persistent per-minute/daily budgets and sending concurrency are built. Configure them against the actual sender's limits and prove controlled sending; quota waits do not consume delivery attempts |
| Data-subject request alerting | The one-month clock is stored and ordered on, but nothing warns when it is close |
| Background export/seating completion | All seven CSV/PDF/XLSX exports and automatic seating use dedicated Postgres workers; frontend job integration and production worker rehearsal remain |
| Seating chart on paper | PDFs and A4 flat place cards are implemented and visually checked with synthetic data; verify the venue's physical printouts |
| Subscription renewal | A lapsed period charges nothing; no card binding is stored, so renewal is manual |
| Invoice tax | `taxMinor` is always zero, so an invoice is not a tax document |
| Entitlement enforcement | Plans publish limits that nothing refuses an action against |
| Multiple organizations per account | Context/lifecycle backend is built; second-membership writes remain disabled and automatic migration retains the user-only index. Operator cutover and frontend acceptance remain |
| Structured log shipping | Logs are JSON in production and go nowhere |

---

## 3. What is genuinely ready

Worth stating, so the list above is read as scope rather than alarm.

- The domain model, with invariants enforced by the database rather than by
  convention alone
- Authentication, authorization and tenant scoping, tested at both outcomes
- Money movement that is exactly-once under concurrency — claim before acting,
  verified with concurrent transactions
- Ticket inventory that cannot oversell, verified with concurrent buyers
- Graceful degradation: Redis and MongoDB can both be down and the API still
  serves correct content
- 1,170+ tests across unit, integration and end-to-end
- Documentation that fails the build when it contradicts the code
- The core loop, end to end: create an event, design and publish the
  invitation, import a guest list, send it, collect RSVPs, seat the room,
  chase non-responders, run the door, thank whoever came

---

## 4. Rough order

1. **Decide the bank** and open the merchant account. It has the longest lead
   time and blocks everything commercial.
2. **A sending domain and its DNS records** (SPF, DKIM, DMARC). The mail transport itself is built.
   Without it the product cannot do its main job.
3. **Deploy somewhere**, with TLS, secrets and backups. Until this exists,
   nothing else can be verified under real conditions.
4. **The P0 items in [BACKLOG.md](BACKLOG.md)**, before the first real
   guest's data is held.
5. Everything in §2, as usage reveals which matters.


### Private snapshot worker gate

Before using snapshots in the pilot, configure the separate private bucket
and verify anonymous reads fail. Deploy the dedicated export worker, check its
heartbeat/failed queue state, exercise termination/lease recovery and a storage
outage, and prove expiry, event deletion and subject erasure clean up stored
bytes. See [worker runbook](../backend/docs/EXPORT_WORKER.md). Frontend adoption,
human review of translated headings and native spreadsheet/printing acceptance remain release
gates in the pilot plan. The separate seating worker is implemented; deploy it,
verify health and termination/lease recovery, and integrate its queued response.
See [seating operations](../backend/docs/SEATING_WORKER.md). PDF/XLSX backend rendering is implemented;
see [renderer acceptance](../backend/docs/EXPORT_RENDERERS.md).


### Guest acknowledgements and gallery gate

- [ ] Accept en/ru/fr/hy typed/drawn/representative flows, revised statements,
  attendee personal links before check-in, pending/error states and host moderation.
- [ ] Run the private media worker, verify its heartbeat/restart policy and
  768 MiB memory bound with maximum accepted images on the real host.
- [ ] Verify private originals/variants cannot be fetched through the public edge.
- [ ] Rehearse removal/DSAR/event deletion with interrupted workers and restore
  both pending media and cleanup tombstones from backup.

Backend contract and operational details are in
[GUEST_CONTRIBUTIONS.md](../backend/docs/GUEST_CONTRIBUTIONS.md). These gates remain
open until frontend and production evidence exists.

### Batch H acceptance on the pilot host

- Review `INVITATION_LEGACY_LIFETIME_REVIEW` counts before launch; old published
  invitations keep existing deadlines and must not be silently reassigned.
- Prove a warm cached guest page, RSVP, gallery/signature file and Telegram
  opt-in close at expiry while authorized host data/media remain readable.
  Move the event date and verify finite expiry/processing state rearm; reopening
  must not reset the captured clock.
- Monitor `invitations.maintain-access` (minute, 55-second lock) and revision
  ledger growth during Redis downtime. Recovery compacts bounded batches;
  request access checks do not depend on sweep availability.
- Repeat `npm run pilot:cache` as a local baseline, then the full production
  workload with TLS/proxy, analytics and writes. Report warm/cold/degraded
  percentiles separately. Rebuild/clear Redis when restoring older Postgres
  backups so cache revisions cannot collide with restored history.

F44 remains gated: no production renderer capability manifest is approved. Keep
new publication closed until actual frontend four-language/font/named palette/
inert preview and mobile/desktop visual acceptance. Private artwork slot activation
and event materialization need separate storage/privacy/worker acceptance; staging
sanitizer tests do not prove production object isolation or frontend rendering.


### First post-pilot wave — backend delivery is not activation

F38/F39/F44 backend slices are implemented; see [current status](post-pilot/execution/IMPLEMENTATION_STATUS.md).
Keep additional memberships, intake/support/conversion and new template features
behind their current gates until their separate acceptance is recorded. This
wave does not approve paid operation or implement later quotes, fiscal documents,
corporate contracts, vendor revenue, calendars or logistics.

- Organization activation needs compatible APIs/workers/maintenance readers and
  writers, old-runtime exclusion, reviewed cutover/restore/performance evidence
  and four-language per-tab client acceptance. No real uniqueness cutover is
  established by isolated test fixtures.
- Production intake needs retained intent keys, an independently preserved latest
  signed privacy journal/manifest, verified restore replay, retention/alert and
  owner-setup/outbox operation, frontend languages and operator acceptance.
  Accepted-owner account identity requires its own proof; a phone-only prospect
  binding does not prove account ownership.
- Authored template publication needs an actual reviewed deployed renderer
  capability, four-language/font/palette/variant/inert-preview visual acceptance,
  private artwork worker/storage proof and the compatible pinned-reader rollback
  floor. Synthetic capability fixtures establish backend behavior only.

Final combined backend verification is recorded by the integration owner; it
cannot replace these activation or existing pilot launch requirements.
