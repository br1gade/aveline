# Deployment

How Aveline runs in production, and what to do when something is wrong.

Written for whoever is holding the pager, which early on is the person who
wrote it. Everything here has been run; where something has not, it says so.

---

## 1. What this is

Six long-running services on one host, plus one-shot migrations and backup tasks:

```
            ┌─────────────────────────────────────────┐
   :443 ──▶ │ caddy      TLS, obtained and renewed    │
            │   │                                     │
            │   └──▶ api        the application        │
            │          │                              │
            │          ├──▶ postgres   the whole domain│
            │          ├──▶ redis      cache, locks    │
            │          ├──▶ mongo      analytics, audit│
            │          └──▶ garage     media, exports  │
            │                                         │
            │        backup      quiesced capture      │
            │        backup-check freshness and space  │
            └─────────────────────────────────────────┘
```

**One machine, deliberately.** Replication and failover cost more to run than
the product earns at this stage, and an architecture nobody can operate is
worse than a simple one whose limits are written down. The limits are in
§7, and in [`../../docs/GOING_LIVE.md`](../../docs/GOING_LIVE.md).

## 2. First deployment

> This stack has been run end to end locally — all seven services healthy,
> migrations applied, TLS served by Caddy, the API answering through it, a
> backup taken and verified, and a full customer journey from `register` to a
> published invitation page. What it has **not** had is a real host, a real
> domain, or a real certificate from Let's Encrypt.

Requires a host with Docker, and DNS for `API_DOMAIN` already pointing at it —
Caddy asks Let's Encrypt for a certificate on first start and that fails if
the name does not resolve to this machine yet.

```bash
git clone <repo> && cd aveline/backend

cp .env.production.example .env.production
chmod 600 .env.production
$EDITOR .env.production          # see §3

# Garage needs its own config and keys. Follow docs/STORAGE.md, then put the
# access key and secret into .env.production.
cp garage/garage.toml.example garage/garage.toml

docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Then check it came up:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -fsS https://$API_DOMAIN/api/v1/health/ready && echo
```

`migrate` runs once and exits; `docker compose ps` showing it as `exited (0)`
is correct. The API will not start until it has succeeded — a failed migration
stops the deploy instead of leaving an API restarting against a schema it
cannot use.

### Seeding the platform

A fresh database has no design templates, no default message copy and no
plans — verified by running this stack from empty. Without them `POST /events`
returns an event with `invitation: null`, `GET /plans` is empty, and sending an
invitation fails partway through a guest list with "template not found".

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm --entrypoint node api \
  dist/seed-production.js
```

It creates **no organization, user, event or guest**, deletes nothing, and is
idempotent — safe on every deploy. A template or price adjusted in production
is not reverted by a redeploy.

**Only the free plan is active.** The paid tiers are seeded with their
entitlements from PRODUCT_SPEC §8 but `priceMinor: 0` and `isActive: false`,
because the price points are still an open decision and `GET /plans` is the
pricing page. Setting a price and activating a plan is a deliberate act.

It runs with plain `node`, not `ts-node`, which is why the script lives under
`src/` and ships compiled: the production image has no dev dependencies.

## 3. Configuration

**Free pilot:** production Compose defaults `PILOT_MODE` to `true`. Paid ticket
checkout and subscription selection are refused with `403` before a payable
order/invoice is committed; payment initiation also checks the policy centrally.
Free tickets and free subscriptions still work. Only the exact strings `true`
and `false` are accepted. Setting `PILOT_MODE=false` is part of a commercial
launch, after the money requirements in GOING_LIVE are satisfied.

Set `MEDIA_DOMAIN` and `S3_PUBLIC_URL` to the public media origin. Caddy sends
that hostname's requests to Garage's web endpoint with `MEDIA_BUCKET_HOST`
(default `aveline-media.web.garage.localhost`), selecting the website-enabled
public bucket. Both domains use filtered access logs that omit URI and headers;
the global runtime logger applies the same filter to proxy error logs, including
502 responses. The API retains sanitized route logs. Exports must never use
this public bucket.

Production Compose uses its env file twice: `--env-file` supplies interpolation
for Compose itself, while each service's `env_file` supplies container variables.
Run all commands in this document with `--env-file .env.production`.

Everything comes from `.env.production`, which exists only on the host. It is
gitignored, and `chmod 600` because every container that reads it runs as a
different user than the one who wrote it.

Five settings the app refuses to boot without, each because the default is
dangerous rather than merely wrong:

| Setting | Why it is required |
|---|---|
| `DATABASE_URL` | Everywhere, not just production |
| `JWT_SECRET` | A default would let anyone mint a staff token |
| `CORS_ORIGINS` | An open policy lets any site call the API as a signed-in user |
| `PUBLIC_APP_URL` | Every emailed link and every bank return lands on `localhost` without it, and payment `returnUrl`s are checked against its origin |
| `SMTP_HOST` + `MAIL_FROM` | Without them email is written to a log file, which looks exactly like delivery |

**Size the database pool on purpose.** `DATABASE_URL` carries
`connection_limit` (per API process) and `pool_timeout`, as
`.env.production.example` shows. Left unset, Prisma's pool is 2 × CPUs + 1,
which moves with the host and, with a second process, can pass Postgres's
`max_connections`. The total across processes must leave room for
migrations and the backup job.

Generate secrets rather than inventing them:

```bash
openssl rand -base64 48
```

`TELEGRAM_WEBHOOK_SECRET` becomes required as soon as `TELEGRAM_BOT_TOKEN` is
set: without it anyone who guessed a guest token could register their own chat
against that guest and receive their invitation.

## 4. Deploying a change

```bash
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Migrations run first and the API only starts if they succeed. The old
container keeps serving until the new one is up.

**There is a gap here, and it is honest to name it:** with one API container
this is a restart, not a zero-downtime deploy — requests in flight during the
swap fail. `stop_grace_period` is 30s so shutdown is clean, but the window
exists. For a product whose traffic is a few hundred guests opening an
invitation, taking the deploy at a quiet hour is a reasonable answer; two
replicas behind Caddy is the real one, and it needs the session store checked
for anything instance-local first.

## 5. Backups and complete recovery

`backup` is now an on-demand maintenance service, not an unattended live-volume
copy loop. Build it first:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build backup
```

Choose a separate off-host Restic repository, configure `RESTIC_REPOSITORY`,
`RESTIC_PASSWORD` and its access credentials, then initialize it explicitly:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm --no-deps backup restic init
```

Keep repository credentials and a recovery copy of the password outside this
machine. Protected configuration is included in the encrypted recovery set;
the password inside that set cannot bootstrap decrypting the set itself.

For an SFTP repository, mount a protected SSH directory read-only at
`/root/.ssh` in the backup service, containing its key/config and verified
`known_hosts`. The backup image includes an SSH client. Do not disable host-key
verification or store SSH secrets in Git; HTTPS object/REST repositories use
the corresponding repository credentials instead.

### Capture and upload

Run `bash scripts/capture-backup.sh` on the Docker host. It locks against another
capture, records which API/worker/Garage services were running, stops them, takes
a Postgres dump and stable Garage data/metadata archives, verifies checksums,
and resumes those services **before** uploading. The backup container never
receives a Docker socket. Capturing without this quiesced boundary is refused.

**The capture is a maintenance window.** API calls and media reads can fail
while these services are stopped. Choose a quiet time, measure the window on
the real dataset and never schedule it across event-day check-in. Upload speed
does not extend this window. The resume journal and boot recovery unit handle a
power loss during capture; traps handle normal command failures/signals.

Restic encrypts/authenticates the recovery set, verifies repository data and
records `offhost-success.json` only after success. Failed uploads retain local
sets and the previous success timestamp. Default retention: 14 local days,
14 remote daily, 8 weekly and 12 monthly snapshots. Remote snapshot expiration
uses one host group despite per-run paths; pruning unused encrypted packs is an
explicit operator maintenance task.

Set includes `postgres.dump`, both Garage archives, release/architecture/version
metadata, checksums, and the protected Garage/application configuration. Redis
and Mongo remain excluded by the existing data-store decision.

### Scheduling

The sample systemd units live in `scripts/systemd/`. Adjust `/opt/aveline` to
the actual checkout, install the service/timer plus boot recovery unit, and
then enable them. The timer template schedules **03:00 Asia/Yerevan**, not the
execution host's timezone. Nothing is installed/enabled automatically here.
`journalctl -u aveline-backup` shows failures.

The additional `aveline-backup-check` service/timer checks every fifteen minutes.
It exits non-zero for missing/stale off-host success (default 30 hours), a future
timestamp, or low backup-volume space (default less than 10GiB free or over 90%
used). Run it manually with `docker compose --env-file .env.production -f
docker-compose.prod.yml run --rm --no-deps backup-check`. A local rehearsal
marker cannot satisfy it. It checks the backup filesystem only; separately
monitor any data volumes placed on other filesystems. Configure the operator's
alerting for failed units and external uptime, and prove alerts arrive before
holding real guest data. Templates do not install an alert destination.

### Restore onto a fresh environment

Download a named recovery set into a new directory, using the same external
repository credentials and password:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm --no-deps \
  -v /secure/recovery:/recovery backup /bin/sh /scripts/fetch-recovery.sh RUN_ID /recovery/download
```

`fetch-recovery.sh` uses Restic verification and checks the file manifest. The
set is under `/secure/recovery/download/backups/RUN_ID` on the host.

Provision empty Garage volumes and a target Postgres database. Stop the API,
workers and Garage, mount that set read-only and both **fresh Garage volumes
writable**, then run `/bin/sh /scripts/restore-recovery.sh /recovery-set` in the
backup image with `RESTORE_QUIESCED=true`. It checks format, architecture,
checksums, archive paths/types and the required Aveline tables **before** writes.
It requires interactive database-name confirmation outside a disposable test.
Existing media volumes are refused rather than overwritten. Postgres restoration
is transactional. If copying media is interrupted, start again with fresh
volumes and the same checked set; do not try to serve a partial copy.

Install the protected configuration for the new host, adjusting its DNS/RPC
address rather than changing stored Garage keys or identity. Use the recorded
Garage version and compatible CPU architecture. Start Garage, then the API,
and verify existing invitation credentials, original media and image variants.
The legacy `restore.sh` remains for older Postgres-only dumps; it does not
recover a complete event on its own.

`npm run backup:rehearsal` exercises a real PostgreSQL/Garage round trip through
an encrypted, isolated local repository. It never marks that local test as
off-host protection. Actual off-host recovery and alert delivery still require
the selected destination and operator configuration.

## 6. When something is wrong

```bash
# What is running, and what keeps restarting
docker compose --env-file .env.production -f docker-compose.prod.yml ps

# The app's own logs. JSON in production; pipe through jq to read them.
docker compose --env-file .env.production -f docker-compose.prod.yml logs api --tail 100 -f

# Is it the app or a dependency?
curl -s https://$API_DOMAIN/api/v1/health/ready | jq
```

`/health/ready` names Postgres, Redis, Mongo and storage. **Only Postgres is
required**: optional outages return 200 with `degraded`; media operations can
fail during a storage outage. Mongo is checked with a real server command,
and storage with a bucket/filesystem probe. Dependency monitoring reports an
outage already present at startup and one recovery message; sweeps propagate
failures to Sentry monitors. Actual notifications need a configured DSN/receiver.

| Symptom | Where to look first |
|---|---|
| API restarting | `logs api` — a missing required setting fails at boot, by design |
| `migrate` exited non-zero | `logs migrate`. The API will not start; fix the migration, do not bypass it |
| TLS not working | `logs caddy`. Usually DNS not pointing here yet, or Let's Encrypt rate limits from repeated attempts |
| Mail not arriving | `logs api` for the send, then the provider. SPF/DKIM/DMARC missing means sent-and-filed-as-spam, which looks like delivery |
| Everyone rate-limited at once | `TRUST_PROXY_HOPS` not `1`, so the limiter sees every request as one client |
| Sweeps stopped | Redis down means no sweeps run, deliberately — unguarded they could double-send. Sentry check-ins should have alerted |

## 7. What this deployment does not do

Stated plainly, because an operator discovering these during an incident is
worse than knowing them now. Each is a row in
[`../../docs/GOING_LIVE.md`](../../docs/GOING_LIVE.md).

- **No failover.** One of everything. The host going down is an outage.
- **No verified off-host protection** until the Restic destination is configured and a remote restore drill succeeds.
- **No zero-downtime deploys.** See §4.
- **No log shipping.** Logs are JSON on this host and rotate with Docker's
  defaults. An incident older than that is not investigable.
- **Backups are not tested on a schedule.** The restore works; nothing proves
  it still works next month.
- **Mongo credentials are required** — it is on the internal network only,
  and nothing is published except Caddy's ports.
- **The image is ~960MB.** Mostly Prisma's engines and runtime plus Sentry.
  It costs a slower first pull, not money.
