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
Several of the bugs expose people's data.

### Money

| # | Blocker | Why |
|---|---|---|
| 1 | **No bank merchant account** | Ameriabank, Inecobank and IDBank each need a business account and, in practice, a visit. Nothing can be charged until one exists |
| 2 | **No adapter has run against a real sandbox** | The three gateways are written against published integrations and their field names are our best reading. They must be checked against the spec each bank sends |
| 3 | **Ameriabank certification not done** | Requires at least five successful completed REST payments in their test environment before production access is granted |
| 4 | **One-step vs two-step not decided** | Deposits probably want authorize-then-capture, which must be requested from the bank separately |
| 5 | **Refunds never executed for real** | The claim-then-call ordering is tested against a fake gateway. It has never moved actual money |

### Communication

| # | Blocker | Why |
|---|---|---|
| 6 | **A sending domain and its DNS** | Email is implemented over SMTP and refuses to boot in production without it, but no mail account, sending domain or SPF/DKIM/DMARC records exist. Without them mail is sent and then filed as spam, which looks like delivery and is not |
| 7 | **Google Workspace is not a transactional sender** | Paid Workspace allows 2,000 messages/day over `smtp.gmail.com` and 10,000/day over `smtp-relay.gmail.com`, so volume is not the blocker it was thought to be. What it lacks is bounce and complaint webhooks, a suppression API and delivery events — so a bounce arriving after the send is never recorded. That is the reason to use a transactional provider, not the cap |

### Security and data

| # | Blocker | Why |
|---|---|---|
| 8 | **`JWT_SECRET` must be real** | The app refuses to boot in production without it, which is the guard — but it must be generated, stored in a secret manager, and rotatable |
| 9 | **`CORS_ORIGINS` must be set** | Also enforced at boot. An open CORS policy lets any site call the API with a user's credentials |
| 10 | **Off-host backup copies** | A verified nightly Postgres dump and Garage archive now run on the host, with a tested restore. They do not survive losing the machine until `BACKUP_SYNC_COMMAND` points somewhere else |
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
| Asynchronous bounce reports | A rejection at send time is classified and suppresses the address. A bounce that arrives minutes later, as a report to the sending mailbox, is not read by anything |
| Provider send-rate throttling | The dispatcher now sends for up to 40 seconds a minute, five at a time, account and ticket mail first — hundreds a minute — with no provider-side rate limit. A provider's quota rejection is retried and never suppresses the guest, but a quota hit mid-send still spreads that send over the retry backoff. Set the provider's limit before a large pilot event |
| Data-subject request alerting | The one-month clock is stored and ordered on, but nothing warns when it is close |
| BullMQ | Cron plus a lock covers periodic sweeps. Retryable per-item work has no queue |
| Seating chart on paper | Every export works as CSV; PDF needs a renderer, and a venue wants the chart printed |
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
