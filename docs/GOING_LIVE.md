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
| 6 | **Nothing reaches anyone** | Every channel resolves to the console transport. Invitations, reset links and ticket confirmations are written to a log file |
| 7 | **No sending domain or SPF/DKIM/DMARC** | Mail from a new domain with no authentication goes to spam, which for an invitation product is indistinguishable from being broken |
| 8 | **Google Workspace limit is ~500/day** | A 400-guest wedding plus one reminder round approaches it. Fine for early events, not for several in a week |

### Security and data

| # | Blocker | Why |
|---|---|---|
| 9 | **`JWT_SECRET` must be real** | The app refuses to boot in production without it, which is the guard — but it must be generated, stored in a secret manager, and rotatable |
| 10 | **`CORS_ORIGINS` must be set** | Also enforced at boot. An open CORS policy lets any site call the API with a user's credentials |
| 11 | **No backups** | Postgres holds the entire domain and Garage holds every photo. Both are single-node. Losing either disk loses everything permanently |
| 12 | **No TLS** | Everything is plain HTTP on localhost today |
| 13 | **GDPR behaviour unimplemented** | The schema supports erasure and export; no endpoint performs either. With EU diaspora guests this is a legal exposure, not a backlog item |
| 14 | **No audit trail** | Modelled and unbuilt. Matters most for `SUPPORT` staff acting on a customer's behalf |

### Operations

| # | Blocker | Why |
|---|---|---|
| 15 | **No deployment** | No container build, no host, no process supervision, no restart policy |
| 16 | **Single-node everything** | Postgres, Redis, Mongo and Garage all run one instance with no failover. Replication factor is 1 |
| 17 | **No `SENTRY_DSN` configured** | Error reporting is wired and inert |
| 18 | **Migrations never run against production data** | Every migration is written to be backfill-safe, and none has been tested against a database with real volume |

---

## 2. Should be true, but would not stop a launch

| Item | Note |
|---|---|
| Image resizing | Originals are stored as uploaded. A 6 MB photo costs 6 MB and serves 6 MB |
| Orphan reclamation | Nothing deletes assets when an event is archived; usage only grows |
| Invitation expiry | Decided (indefinite paid, 3 months free) and modelled; nothing sets `expiresAt` or sweeps |
| CDN | Garage serves media directly |
| Rate limits per actor | The throttle is global, not per account |
| BullMQ | Cron plus a lock covers periodic sweeps. Retryable per-item work has no queue |
| Seating chart export | Seating is assigned and readable; nothing prints it, and a venue still wants paper |
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
2. **One real mail transport**, plus the sending domain and its DNS records.
   Without it the product cannot do its main job.
3. **Deploy somewhere**, with TLS, secrets and backups. Until this exists,
   nothing else can be verified under real conditions.
4. **GDPR endpoints**, before the first EU guest's data is held in production
   rather than after.
5. Everything in §2, as usage reveals which matters.
