# Going Live

> **Status: under local development. Not live, no production deployment, no
> real users, no real money.** Everything runs on one developer machine
> against local containers.

This is what has to be true before that changes. Nothing here is a
nice-to-have — each item is either a way to lose money, lose data, or lose a
customer's trust.

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

### Money

| # | Blocker | Why |
|---|---|---|
| 1 | **No bank merchant account** | Ameriabank, Inecobank and IDBank each need a business account and, in practice, a visit. Nothing can be charged until one exists |
| 2 | **No adapter has run against a real sandbox** | The three gateways are written against published integrations and their field names are our best reading. They must be checked against the spec each bank sends |
| 3 | **Ameriabank certification not done** | Requires at least five successful completed REST payments in their test environment before production access is granted |
| 4 | **One-step vs two-step not decided** | Deposits probably want authorize-then-capture, which must be requested from the bank separately |
| 4b | **Three suspected field mismatches** | Ameriabank's `OrderID` may need to be an integer; ArCa may expect AMD in luma (× 100); Ameriabank's `OrderStatus` is read with ArCa's codes. Each must be confirmed against the bank's own specification — see PAYMENTS.md §6 |
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
| 11 | **A host and a domain** | The stack has now been run end to end locally — seven services healthy, migrations applied, TLS served by Caddy, a verified backup taken, and a full journey from `register` to a published invitation page. What it has never had is a real host, a real domain, or a certificate from Let's Encrypt |
| 12b | **An SMS provider** | The channel is built and inert. Choose a provider that reaches Armenian numbers, write its adapter (one class), and set `SMS_PROVIDER`. Until then guests with only a phone number are reported unreachable |
| 12 | **WhatsApp business verification** | The transport is built and inert. Meta needs a verified business — trade licence, tax papers, a dedicated number — and message templates approved in advance. Days to weeks, like the bank accounts |
| 13 | **GDPR identity verification is manual** | Requests are accepted, tracked against the one-month clock, and carried out — erasure anonymises, export assembles. But nothing verifies who is asking, so a human must do it before pressing fulfil, and nothing alerts on the clock running down |

### Operations

| # | Blocker | Why |
|---|---|---|
| 14 | **Zero-downtime deploys** | One API container, so a deploy is a restart and requests in flight fail. Acceptable at a few hundred guests; two replicas is the real answer |
| 15 | **Single-node everything** | Postgres, Redis, Mongo and Garage all run one instance with no failover. Replication factor is 1 |
| 16 | **Two dependency advisories accepted, not fixed** | Both reached only through code a request cannot touch — a Prisma config file we own, and Swagger, which is disabled in production. Each is fixed by a migration named in `backend/docs/DEPENDENCIES.md`: Prisma 7 needs a driver adapter, and NestJS 12 needs ESM |
| 17 | **No `SENTRY_DSN` configured** | Error reporting is wired and inert |
| 18 | **Migrations never run against production data** | Every migration is written to be backfill-safe, and none has been tested against a database with real volume |

---

## 2. Should be true, but would not stop a launch

| Item | Note |
|---|---|
| Orphan reclamation | Nothing deletes assets when an event is archived; usage only grows |
| Invitation expiry | Decided (indefinite paid, 3 months free) and modelled; nothing sets `expiresAt` or sweeps |
| CDN | Garage serves media directly |
| Shared rate limits | Limits are per account or per address, but counted in each instance's memory: a second API instance doubles them. `POST /privacy/requests` has only the general public limit |
| Asynchronous bounce reports | Signed provider-neutral delivery/bounce/complaint ingestion is built. Native provider/mailbox integration stays deferred by D30; it is not connected to real delivery events |
| Provider send-rate throttling | Persistent per-minute/daily budgets and sending concurrency are built. Configure them against the actual sender's limits and prove controlled sending; quota waits do not consume delivery attempts |
| Data-subject request alerting | The one-month clock is stored and ordered on, but nothing warns when it is close |
| Background export/seating completion | All seven CSV/PDF/XLSX exports use the dedicated Postgres worker; asynchronous seating and production worker rehearsal remain |
| Seating chart on paper | PDFs and A4 flat place cards are implemented and visually checked with synthetic data; verify the venue's physical printouts |
| Subscription renewal | A lapsed period charges nothing; no card binding is stored, so renewal is manual |
| Invoice tax | `taxMinor` is always zero, so an invoice is not a tax document |
| Entitlement enforcement | Plans publish limits that nothing refuses an action against |
| Multiple organizations per account | One per account today; a planner with two agencies cannot be served |
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
translated headings, native spreadsheet/printing acceptance and background seating
remain release gates in the pilot plan. PDF/XLSX backend rendering is implemented;
see [renderer acceptance](../backend/docs/EXPORT_RENDERERS.md).
