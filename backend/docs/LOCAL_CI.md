# Local CI and the push gate

Run the same four backend jobs locally before sending commits to GitHub. The
command lists live in `scripts/ci-job.mjs`, which GitHub Actions also invokes.
Local CI adds workflow linting with a pinned actionlint image. Remote CI remains
required for integration with GitHub; these commands never publish or deploy.

## First use

Requires Linux, Node 24+, Git, a local Docker Engine Unix socket and Compose
2.30+. Docker Desktop/remote daemon orchestration is not implemented. Allow disk
space for cached images and at least 6 GiB available memory for a sequential run.
Daemon validation follows Docker's `DOCKER_CONTEXT` precedence over `DOCKER_HOST`.
Initial image builds need internet access; cached dependencies/images are reused.

From `backend/`:

```bash
npm run ci:install-hook
# Commit your work; the gate validates a committed snapshot.
npm run ci:local
npm run ci:status
git push
```

Use `npm run ci:local -- --jobs 2` to run integration and HTTP in parallel on a
machine with enough memory (each test runner has a 6 GiB limit). The default is
one database-backed layer at a time. Quality checks and container rehearsals run
first so cheaper failures stop the run before the long suites. `--revision REF`
can validate another committed branch/tag. A dirty worktree is refused for manual
runs, so uncommitted work cannot accidentally be mistaken for tested source.

The installer copies the tracked `.githooks/pre-push` template into a dedicated
directory in Git's common metadata and configures it for this local repository.
Git does not install hooks on clone; repeat this step on each clone. Preserve and
integrate any existing custom pre-push hook rather than replacing it. The persistent
hook covers worktrees and branch switches. It refuses pushes
from older branches missing the local CI entry point; carry the CI files onto
maintained branches before pushing them. Hook configuration is local,
not a source-controlled server policy or a replacement for protected-branch checks.

## What runs

1. Archive the requested commit into a new private directory. Ignored local env
   files, credentials, development databases and untracked files never enter the snapshot.
2. Lint explicit workflow files with the pinned actionlint image (the snapshot
   contains no Git metadata), then build the CI runner.
3. Run lint, docs/OpenAPI, source/test type checks, build, all unit tests, and
   pilot/backup/operations/CI-tool regression tests.
4. Build the application/backup images and exercise real Caddy TLS/privacy,
   Compose fresh deployment/redeployment, the pilot journey and encrypted restore.
5. Run the full integration and HTTP suites, each against a different disposable
   PostgreSQL/Redis/Mongo/Mailpit project with no published dependency ports.

The quality/integration/HTTP runner uses pinned Node 26 and Ubuntu 24.04 base
images, `npm ci` from the lockfile and explicit PostgreSQL 16 clients.
Both local and GitHub jobs set a 4 GiB JavaScript heap for the complete Nest/Jest
suite; the local container leaves another 2 GiB for native tools and overhead.
No host PostgreSQL client or host node_modules is used for those layers. The host Node
24+ process orchestrates Docker rehearsals; tested API/worker code runs inside
the production Node 26 image. No Docker socket is mounted in the test runners.
Shell prerequisites such as `jq` and `flock` are included in the runner image.
All flags, SMTP and database endpoints are synthetic isolated settings, not the
host's application env. No bank/provider/production credentials are required.

## Evidence and reuse

Private logs and `summary.json` live under repository-root `.local-ci/runs/`.
The command prints their location on failure. All four layers and cleanup must
succeed before it atomically writes a proof under `.local-ci/proofs/`. These
paths are ignored by Git. Inspect them locally; do not upload raw logs as public
artifacts. Logs may contain synthetic guest links and test credentials.

The pre-push hook validates **each distinct commit being pushed**, including
non-HEAD branches and annotated tags. Deletions require no test run. An unchanged
Git tree can reuse a complete proof for 24 hours; changing source, configuration,
lockfiles or workflow files invalidates it. Commit-message-only amendments can
reuse the same tree. Missing, incomplete, malformed, future-dated or stale proofs
trigger a complete local run. Failed/interrupted runs never create a success proof.
Starting a fresh validation invalidates any earlier proof for that tree. A local
run lock prevents duplicate concurrent work and blocks pushes during validation.
After a crash, inspect the recorded PID before removing a stale `.local-ci/run.lock`.
Repeated pushes of already-verified source therefore avoid rerunning local CI.

## Isolation and cleanup

Every run reserves a fresh `av-ci-<random>` namespace and refuses pre-existing
resources in it. Compose volumes/networks and rehearsal resources use that
namespace. Completion/failure/SIGINT/SIGTERM removes only those containers,
networks, volumes and image tags; shared Docker build caches/base images remain.
It never uses `docker system prune`, existing dev Compose projects or real env
files. Failed cleanup also fails the gate. A machine crash or forced process
kill may require operator cleanup: use the exact scope in the private run summary
and inspect its resource names before removal. Never prune the whole daemon.

Not yet implemented: macOS/Windows orchestration, frontend CI before a frontend
stack exists, cross-machine proof distribution or hosted release/deploy emulation.
The local command deliberately executes validation only.
