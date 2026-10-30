# Release and promotion jobs

The repository contains CI, image publication and SSH deployment workflows.
They are configuration ready for review; no live release, registry publication,
SSH deployment or GitHub environment configuration has been executed here.
The host runbook is [DEPLOYMENT.md](DEPLOYMENT.md).

## Jobs and trust boundary

| Workflow | Trigger | Result |
|---|---|---|
| `backend.yml` | Push/PR; reusable | Parallel quality/unit, integration and HTTP checks; container/edge/pilot/backup rehearsals |
| `release.yml` | Manual on default branch | Repeats quality checks, builds/rehearses exact API/backup images, publishes GHCR digests and attestations, saves a nonsecret release manifest |
| `deploy.yml` | Manual on default branch | Promotes a successful release run to staging or production after manifest/provenance verification and verified SSH |

Production uses digest references, never a floating tag. Publication is serialized;
each deployment target is serialized without cancellation. Deployment validates
the successful dispatch run, repository/default branch, source commit, manifest
and both OCI attestations before transferring tracked source. The remote
controller handles maintenance, backups, compatibility checks and migration.
Only success updates the host's `current` symlink. No automatic database rollback
or old-image restart is attempted. API and all four workers share one image.
Failed integration/HTTP suites emit bounded assertion diagnostics as GitHub check
annotations; the original test command still fails. Test results use disposable
data and contain no production credentials.

## Configure GitHub once

1. Protect the default branch and require the quality, integration, HTTP and
   container checks. Require review for workflow changes; restrict who can dispatch releases.
2. Create environments `release`, `staging` and `production`. Set required reviewers,
   prevent self approval where available, and restrict deployment branches to the
   default branch. The workflow names alone do not install these protections.
3. Allow GHCR publication and artifact attestations for this repository. Release
   job permissions are scoped to contents read, packages write, OIDC and attestation
   write; the deployment job uses read access only. Grant private-package read
   access to the deployment token/host as appropriate; use separate host read credentials.
4. Add the following environment settings for **each** staging/production target.

| Type | Name | Value |
|---|---|---|
| Variable | `DEPLOY_HOST` | SSH hostname, without protocol or options |
| Variable | `DEPLOY_USER` | Dedicated Unix operator with Docker access |
| Variable | `DEPLOY_ROOT` | Absolute release root, e.g. `/opt/aveline` |
| Variable | `DEPLOY_PROFILE` | Absolute private profile, e.g. `/etc/aveline/production` |
| Variable | `DEPLOY_PROJECT` | Exact profile project, e.g. `aveline-production` |
| Secret | `DEPLOY_SSH_KEY` | Dedicated deployment private key |
| Secret | `DEPLOY_KNOWN_HOSTS` | Host public key verified through an independent trusted channel |

Never populate known_hosts by blindly trusting an in-job `ssh-keyscan`. Host
identity checking is strict; a mismatch stops promotion. Secrets/configuration
for SMTP, databases, Garage, journal and Restic remain on the host, not in the
release manifest or source archive. GitHub artifact retention is 90 days for the
small nonsecret manifest; retain release evidence longer under your own policy.

## Prepare the host

Install Linux, Node 24+, Docker Engine/Compose 2.30+, Bash, `flock`, OpenSSH and
GNU tar/coreutils. Provision the dedicated user, authorized public key, private
profile and writable release root. Run the wizard as that user and give it
ownership of both directories. Docker group access grants host-level
capabilities; restrict this account accordingly. The workflow requires normal
SSH/SCP and outbound registry access; it does not install a runtime or alter the
firewall. Configure host read credentials if GHCR images are private.

Create the production profile following DEPLOYMENT. Verify domains, SMTP, storage,
backup credentials, registry login and disk capacity. Use distinct release roots, profiles, projects and volumes for staging and
production; prefer separate hosts. Do not generate new
credentials for existing populated volumes. Configure off-host privacy-journal
preservation independently of ordinary recovery sets.

## Release and promote

1. Merge reviewed source to the default branch; run **Build and publish reviewed
   release** from Actions. Approve the `release` environment when prompted.
2. Wait for the complete successful run. Its manifest binds the source commit
   and both digests to the run ID. No production credentials are required to build it.
3. Run **Deploy an attested release** with that run ID, target `staging`, and its
   exact Compose project name. Approve the environment, then inspect host health,
   application smoke checks, worker queues, mail and backup evidence.
4. Promote the **same** run ID to `production` during the agreed maintenance
   window, using its exact project name and required reviewer approval.
5. Verify public HTTPS, guest/account workflows, all worker healthchecks and
   off-host monitoring. Install the reviewed host timer/recovery units separately.

The host's private `release-state.json` records current/previous images;
`deployment-attempt.json` records the most recent stage/result. A failed attempt
keeps its source directory and protected logs for diagnosis and leaves `current`
pointing at the last successful source. Check actual container/database state
before retrying: migrations may already have changed the schema. `rollback-plan`
is informational; all rollback attempts must pass reader and journal preflight.
Do not replace the database with an older snapshot as a release rollback.

Official platform references: [Compose raw env files](https://docs.docker.com/reference/compose-file/services/#env_file),
[deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments),
[artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

Not yet completed: live Actions execution, actual reviewer/secret/registry setup,
provisioning, external alerting and remote restore/production acceptance. No
frontend container, multi-host orchestration or zero-downtime rollout is supplied.
