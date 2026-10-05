# Deployment

How Aveline runs in production, and what to do when something is wrong.

Written for whoever is holding the pager, which early on is the person who
wrote it. Everything here has been run; where something has not, it says so.

---

## 1. What this is

One host, running six containers behind Caddy:

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
            │        backup      nightly, verified     │
            └─────────────────────────────────────────┘
```

**One machine, deliberately.** Replication and failover cost more to run than
the product earns at this stage, and an architecture nobody can operate is
worse than a simple one whose limits are written down. The limits are in
§7, and in [`../../docs/GOING_LIVE.md`](../../docs/GOING_LIVE.md).

## 2. First deployment

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

docker compose -f docker-compose.prod.yml up -d --build
```

Then check it came up:

```bash
docker compose -f docker-compose.prod.yml ps
curl -fsS https://$API_DOMAIN/api/v1/health/ready && echo
```

`migrate` runs once and exits; `docker compose ps` showing it as `exited (0)`
is correct. The API will not start until it has succeeded — a failed migration
stops the deploy instead of leaving an API restarting against a schema it
cannot use.

### Seeding the first account

The platform needs at least one design template before an event can be created
with an invitation. `npm run seed` does that along with demo data, which is
**not** what you want on a real deployment. For now, insert a template
directly, or run the seed and delete the demo organization afterwards.

> Not yet built: a production-safe seed that inserts only the design templates
> and default message copy. Worth doing before the first customer.

## 3. Configuration

Everything comes from `.env.production`, which exists only on the host. It is
gitignored, and `chmod 600` because every container that reads it runs as a
different user than the one who wrote it.

Four settings the app refuses to boot without, each because the default is
dangerous rather than merely wrong:

| Setting | Why it is required |
|---|---|
| `DATABASE_URL` | Everywhere, not just production |
| `JWT_SECRET` | A default would let anyone mint a staff token |
| `CORS_ORIGINS` | An open policy lets any site call the API as a signed-in user |
| `SMTP_HOST` + `MAIL_FROM` | Without them email is written to a log file, which looks exactly like delivery |

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
docker compose -f docker-compose.prod.yml up -d --build
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

## 5. Backups

A nightly dump of Postgres and an archive of Garage, kept 14 days, in the
`backups` volume. Redis and Mongo are deliberately not backed up: one holds
cache and locks, the other append-only analytics and the audit trail. Losing
either costs insight, not correctness.

```bash
docker compose -f docker-compose.prod.yml logs backup --tail 20   # did it run
docker compose -f docker-compose.prod.yml exec backup ls -lh /backups
```

Every dump is verified readable with `pg_restore --list` at the moment it is
taken, because a dump nobody has read is a guess.

**These backups do not survive losing the host.** They are on the same disk as
the database. Set `BACKUP_SYNC_COMMAND` to something that copies `/backups`
elsewhere — the script runs it after each successful backup and warns in the
log while it is unset:

```bash
BACKUP_SYNC_COMMAND=rclone sync /backups remote:aveline-backups
```

### Restoring

Read this before you need it. The round trip below has been run: a dump of the
development database restored into a scratch database, giving back 47 tables,
17 migrations and every row.

```bash
docker compose -f docker-compose.prod.yml run --rm \
  -v aveline_backups:/backups backup \
  /bin/sh /scripts/restore.sh /backups/postgres-20261006T030000Z.dump
```

It asks you to type the database name, then prints what it restored — table,
migration, event, guest and payment counts. That report is the point: "done"
after restoring an empty or wrong dump is indistinguishable from "done" after
the right one, which was true of this script until a test caught it.

If the dump was empty the script fails and says so. **Nothing is destroyed in
that case** — `pg_restore --clean` only drops objects the dump itself
contains, so an empty dump is a no-op.

Afterwards:

```bash
docker compose -f docker-compose.prod.yml restart api
curl -fsS https://$API_DOMAIN/api/v1/health/ready
```

> **Practise this once, on purpose, before you need it.** A restore procedure
> that has only been read is a procedure with an unknown number of steps
> missing.

## 6. When something is wrong

```bash
# What is running, and what keeps restarting
docker compose -f docker-compose.prod.yml ps

# The app's own logs. JSON in production; pipe through jq to read them.
docker compose -f docker-compose.prod.yml logs api --tail 100 -f

# Is it the app or a dependency?
curl -s https://$API_DOMAIN/api/v1/health/ready | jq
```

`/health/ready` names each dependency. **Only Postgres is required**: Redis
and Mongo down means slower responses and no engagement figures, not an
outage, and that is tested.

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
- **No off-host backups** until `BACKUP_SYNC_COMMAND` is set.
- **No zero-downtime deploys.** See §4.
- **No log shipping.** Logs are JSON on this host and rotate with Docker's
  defaults. An incident older than that is not investigable.
- **Backups are not tested on a schedule.** The restore works; nothing proves
  it still works next month.
- **Mongo is unauthenticated between containers** — it is on the internal
  network only, and nothing is published except Caddy's ports.
- **The image is ~960MB.** Mostly Prisma's engines and runtime plus Sentry.
  It costs a slower first pull, not money.
