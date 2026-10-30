# Deployment

Aveline runs on one Linux Docker host. Deployment tooling is implemented and
rehearsed locally; no production host, public certificate or GitHub environment
has been configured by this delivery. See [RELEASES.md](RELEASES.md) for GitHub
release/promotion setup and [GOING_LIVE](../../docs/GOING_LIVE.md) for activation gates.

## Stack and prerequisites

`docker-compose.prod.yml` runs Caddy, API, PostgreSQL, Redis, MongoDB, Garage and
four workers: `export-worker`, `seating-worker`, `private-media-worker` and
`template-asset-worker`. All workers and migrations use the same API image.
One-shot services perform migrations, seeding, privacy recovery and backups.
The app image runs as `node` under `tini`; only Caddy publishes production ports
80/443. Docker logs rotate at 10 MB with three files per service.

Use Linux, Docker Engine with **Compose 2.30+**, Node **24+** on the host, Bash,
`flock` and sufficient disk/RAM for the configured container limits and backup
sets. Containers use Node 26. The local overlay adds Mailpit and publishes only
loopback API/media/mail UI ports; it never reuses the development Compose names.
This packages the backend. A frontend application has not been built here.

Postgres holds the domain. Redis/Mongo outages degrade optional capabilities;
scheduled sweeps deliberately pause without Redis locks. Garage outages prevent
media work. API readiness requires Postgres; worker heartbeat checks are
separate. An external uptime/worker/backup alert receiver remains operator work.

## Local full-stack wizard

From `backend/`:

```bash
npm run ops -- init --mode local --project aveline-local
npm run ops -- check
npm run ops -- plan
npm run ops -- apply --confirm aveline-local
npm run ops -- status
```

The wizard writes `.deployment/local/` with private directory/file permissions
0700/0600. Initialization refuses to overwrite an existing profile. Local mode
builds both images, provisions fresh storage, applies migrations, seeds reference
data and waits for API/worker/gateway health. It runs `NODE_ENV=production`, with
SMTP captured by Mailpit. Defaults: API `http://127.0.0.1:8080/api/v1`, media
`:8081`, Mailpit `http://127.0.0.1:8026`. Swagger is disabled. No demo users,
organizations or events are seeded; only the free plan is active.

Interactive initialization asks for local/production mode. For automation use a
private 0600 JSON answers file with `--answers /private/answers.json`. Local
answers support `apiPort`, `mediaPort`, `mailPort`; production answers use
`apiDomain`, `mediaDomain`, `appUrl`, `acmeEmail`, `smtpHost`, `mailFrom`, and
optional `smtpPort`, `smtpUser`, `smtpPassword`, plus `mode` and `project`.
Do not pass passwords on the command line or upload answers as CI artifacts.

`npm run ops:rehearsal` expects prebuilt `aveline-api:ops-test` and
`aveline-backup:ops-test` (override `OPS_REHEARSAL_IMAGE` and
`OPS_REHEARSAL_BACKUP_IMAGE`). It uses a unique disposable project, real stores,
migrations, all workers, literal-secret checks, redeployment and local capture.
It deletes only its own containers/volumes and retains protected failure diagnostics.

## Production profile and first release

Prepare DNS for both API and media hosts, ports 80/443, the frontend HTTPS
origin, SMTP sending credentials and authenticated sending-domain DNS. On the
host, initialize a private profile **outside the release checkout**:

```bash
node backend/scripts/ops.mjs init --mode production --project aveline-production --directory /etc/aveline/production
node backend/scripts/ops.mjs check --directory /etc/aveline/production
```

The wizard generates separate database/JWT/Garage/privacy secrets. It defaults
`PILOT_MODE=true` and keeps enquiry/template feature flags off. It does not
select a bank, tax treatment, prices or turn on paid features. Follow the
feature-specific operational acceptance gates before changing those flags.
Never initialize over a populated installation or rotate restored keys by rerunning
`init`. `import --mode production --project PROJECT --source-env FILE
--garage-config FILE --directory NEW_PROFILE` preserves existing credentials;
its source env must use the generated canonical format (the example also supports
plain unquoted values). Preserve the original project and volume identities.

The profile contains `settings.json`, canonical `.env`, literal `.runtime.env`
and `garage.toml`. Keep all four protected. The ops overlay uses Compose raw
`env_file` mode so dollar signs, quotes and backslashes in secrets remain literal.
Use `configure --directory PROFILE --key SMTP_PASSWORD` for hidden entry, or
`--stdin` from a protected secret source. Do not shell-source these files.
After manually reviewing/editing canonical `.env`, run `sync --directory PROFILE`
to regenerate its runtime mirror; mismatches block further deployment. Avoid
`docker compose config` without `--quiet` because resolved configuration exposes secrets.

Production apply requires immutable image references from a tested release:

```bash
node backend/scripts/ops.mjs plan --directory /etc/aveline/production --image ghcr.io/OWNER/REPO/api@sha256:DIGEST --backup-image ghcr.io/OWNER/REPO/backup@sha256:DIGEST
node backend/scripts/ops.mjs apply --directory /etc/aveline/production --image ghcr.io/OWNER/REPO/api@sha256:DIGEST --backup-image ghcr.io/OWNER/REPO/backup@sha256:DIGEST --confirm aveline-production
```

Substitute real lowercase repository/digests. The host must be able to pull both
images. The controller creates only a new, project-labelled external privacy
volume; an existing volume must already have matching ownership/permissions.
Garage bootstrapping sets up one explicitly unassigned node only, preserves an
existing layout/key, enables website reads only on the public bucket and denies
website access on the distinct private bucket. Secrets are saved privately.

Apply validates configuration, pulls images, checks the candidate reader floor,
configuration and privacy journal, backs up a populated installation, stops all
application writers, repeats preflight while quiesced, migrates/seeds and checks
all processes plus the public readiness endpoint. A deployment lock serializes
configuration, backups and journal maintenance. No database reset is used.

**This is a maintenance deployment.** Writer stoppage/migrations and coordinated
backup capture cause downtime. Schedule away from check-in. Failed migration or
health checks leave a protected `deployment-attempt.json` and `last-error.json`.
They never trigger database restore or an automatic restart of an older image.
Review failure state privately, correct the cause and rerun the same candidate.
`rollback-plan` shows previous digests; any rollback still needs candidate reader
preflight and maintenance. It never downgrades the database. A stale lock is not
automatically removed: verify its recorded process before operator removal.

## Privacy journal and restore boundary

The signed enquiry privacy journal is an **independent external Docker volume**.
Ordinary database/media backups exclude it. Normal Compose volume teardown cannot
delete it. Independently preserve the latest journal, its key/identity and
high-water sequence off host; a database snapshot is insufficient. No deployment,
import or ordinary boot initializes an absent journal over enquiry history.

For a genuinely new installation, before enabling enquiries, stop writers and
explicitly initialize once:

```bash
node backend/scripts/ops.mjs stop-writers --directory PROFILE --confirm PROJECT
node backend/scripts/ops.mjs journal-init --new-install --directory PROFILE --confirm PROJECT
```

After restoring data, keep writers stopped, independently restore the **latest**
journal/keys, verify the external high-water sequence and run:

```bash
node backend/scripts/ops.mjs journal-recover --latest-verified --sequence VERIFIED_SEQUENCE --directory PROFILE --confirm PROJECT
```

These commands refuse running writers. Reapply the candidate only after replay
and acceptance checks. See [SALES_INTAKE.md](SALES_INTAKE.md) for journal identity,
rotation and replay rules. Do not substitute an old journal from a backup.

## Backups and host jobs

Configure `RESTIC_REPOSITORY`, `RESTIC_PASSWORD` and credentials with `configure`,
then `backup-init --directory PROFILE --confirm PROJECT` for a new encrypted
repository. Keep decrypting credentials separately off host. Populated production
releases require off-host backup configuration and a successful upload; local
profiles deliberately perform local-only capture and cannot satisfy freshness checks.
Maintenance uses the recorded immutable release images. Before the first release,
pass its approved `--image` and `--backup-image` digests explicitly; production
maintenance refuses floating-image fallbacks.

`backup --directory PROFILE --confirm PROJECT` locks the operation, records running
writers/Garage, stops them, dumps Postgres and stable Garage metadata/data, verifies
checksums, then resumes those services **before** Restic upload. The backup
container has no Docker socket. Capture traps resume on normal failure; the
protected `backup-state/resume-services` journal supports recovery after power
loss through `backup --resume-only`. If power loss also leaves a deployment lock,
verify that its recorded process is gone before removing that stale lock and
retrying the resume service. Privacy-journal preservation is separate.

Encrypted sets include dump, Garage archives, checksums, release/architecture
metadata and protected application/Garage configuration. Redis/Mongo are excluded.
Default retention is 14 local days and 14 daily/8 weekly/12 monthly remote
snapshots; encrypted pack pruning is explicit operator maintenance.
`backup-check` rejects missing/stale/future off-host timestamps and low backup
filesystem space (30 hours, 10 GiB free, 90% used defaults). Monitor other data
filesystems separately. An isolated local repository cannot prove off-host recovery.

Generate reviewable systemd jobs for the stable release path:

```bash
node backend/scripts/ops.mjs jobs --directory PROFILE --release-root /opt/aveline --operator-user aveline
```

The private `PROFILE/systemd/` templates provide a 03:00 Asia/Yerevan backup timer,
a 15-minute backup check, and boot resume service. Review paths, Docker permissions,
Node PATH and `OnFailure` alert routing. Install/enable them explicitly after the
first successful release creates `/opt/aveline/current`. Nothing is installed by
the wizard. Check alert delivery and a real remote restore before launch.

For SFTP Restic, add a read-only protected `/root/.ssh` mount with verified
`known_hosts` to the backup service; no SSH credentials are invented or installed.
HTTPS/object repositories use their corresponding access credentials.

For restoration, `/scripts/fetch-recovery.sh RUN_ID /recovery/download` in the
backup image verifies/downloads the named encrypted set into a mounted private
host directory. `/scripts/restore-recovery.sh /recovery-set` requires quiesced
writers/Garage, `RESTORE_QUIESCED=true`, fresh writable Garage data/metadata
volumes, target database-name confirmation and compatible architecture/Garage
version. It validates checksums/archive paths/table names before writes and
restores Postgres transactionally. Interrupted media copying requires fresh
volumes again. Never restore over active data. Restore protected configuration
without changing stored Garage identity; replay the latest independent privacy
journal before any writer restarts. Verify invitation credentials and
original/variant/private media on the target. `npm run backup:rehearsal` tests an
isolated encrypted round trip; it does not mark production as protected.

## Diagnostics and remaining work

`status --directory PROFILE` reports service state without dumping environment
values. Inspect private Docker logs and `deployment-attempt.json`/`last-error.json`
locally. API readiness is `/api/v1/health/ready`; worker health uses heartbeat
files. Caddy strips URI/headers from access and proxy-error logs because URLs
contain credentials. Public media routing uses its own hostname/bucket host.

Not yet completed: production provisioning/DNS/TLS, real SMTP delivery, GitHub
reviewer/secret setup, off-host journal and database/media restore drills,
external alert delivery, performance/capacity evidence, scheduled restore drills,
log shipping, failover and zero-downtime deployment. Refer to
[EXPORT_WORKER](EXPORT_WORKER.md), [SEATING_WORKER](SEATING_WORKER.md),
[GUEST_CONTRIBUTIONS](GUEST_CONTRIBUTIONS.md) and
[TEMPLATES](../../docs/post-pilot/execution/TEMPLATES.md) for feature-specific acceptance.
