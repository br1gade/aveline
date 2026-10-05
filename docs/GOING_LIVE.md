# Going Live

> **Status: under local development. Not live, no production deployment, no
> real users, no real money.** Everything runs on one developer machine
> against local containers.

This is what has to be true before that changes. Nothing here is a
nice-to-have — each item is either a way to lose money, lose data, or lose a
customer's trust.

---

## 1. Blocking — cannot go live without these

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
| 7 | **Google Workspace limit is ~500/day** | A 400-guest wedding plus one reminder round approaches it. Fine for early events, not for several in a week |

### Security and data

| # | Blocker | Why |
|---|---|---|
| 8 | **`JWT_SECRET` must be real** | The app refuses to boot in production without it, which is the guard — but it must be generated, stored in a secret manager, and rotatable |
| 9 | **`CORS_ORIGINS` must be set** | Also enforced at boot. An open CORS policy lets any site call the API with a user's credentials |
| 10 | **No backups** | Postgres holds the entire domain and Garage holds every photo. Both are single-node. Losing either disk loses everything permanently |
| 11 | **No TLS** | Everything is plain HTTP on localhost today |
| 12 | **GDPR identity verification is manual** | Requests are accepted, tracked against the one-month clock, and carried out — erasure anonymises, export assembles. But nothing verifies who is asking, so a human must do it before pressing fulfil, and nothing alerts on the clock running down |
| 13 | **No audit trail** | Modelled and unbuilt. Matters most for `SUPPORT` staff acting on a customer's behalf |

### Operations

| # | Blocker | Why |
|---|---|---|
| 14 | **No deployment** | No container build, no host, no process supervision, no restart policy |
| 15 | **Single-node everything** | Postgres, Redis, Mongo and Garage all run one instance with no failover. Replication factor is 1 |
| 16 | **No `SENTRY_DSN` configured** | Error reporting is wired and inert |
| 17 | **Migrations never run against production data** | Every migration is written to be backfill-safe, and none has been tested against a database with real volume |

---

## 2. Should be true, but would not stop a launch

| Item | Note |
|---|---|
| Image resizing | Originals are stored as uploaded. A 6 MB photo costs 6 MB and serves 6 MB |
| Orphan reclamation | Nothing deletes assets when an event is archived; usage only grows |
| Invitation expiry | Decided (indefinite paid, 3 months free) and modelled; nothing sets `expiresAt` or sweeps |
| CDN | Garage serves media directly |
| Rate limits per actor | The throttle is global, not per account. `POST /privacy/requests` is public and unthrottled |
| Asynchronous bounce reports | A rejection at send time is classified and suppresses the address. A bounce that arrives minutes later, as a report to the sending mailbox, is not read by anything |
| Reminder volume against the send limit | Three automatic reminders per event plus invitations will cross Google Workspace's ~500/day limit on a large wedding; nothing throttles or warns |
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
- 300+ tests across unit, integration and end-to-end
- Documentation that fails the build when it contradicts the code

---

## 4. Rough order

1. **Decide the bank** and open the merchant account. It has the longest lead
   time and blocks everything commercial.
2. **A sending domain and its DNS records** (SPF, DKIM, DMARC). The mail transport itself is built.
   Without it the product cannot do its main job.
3. **Deploy somewhere**, with TLS, secrets and backups. Until this exists,
   nothing else can be verified under real conditions.
4. **GDPR endpoints**, before the first EU guest's data is held in production
   rather than after.
5. Everything in §2, as usage reveals which matters.
