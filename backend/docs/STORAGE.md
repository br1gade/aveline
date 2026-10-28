# Storage

Public media goes through `StorageService`; private generated artifacts use
`PrivateStorageService`. Callers never access disk or buckets directly.
Two backends sit behind it and no call site knows which is in use.

---

## 1. Why Garage

Self-hosted, S3-compatible, single Rust binary, free. Chosen over the
alternatives for specific reasons:

**Not MinIO.** The usual answer, and no longer a safe one: the community
edition lost its admin UI in mid-2025, went into maintenance mode, and the
repository was **archived read-only in April 2026**. The AGPL licence stands;
nobody is maintaining or publishing builds.

**Not SeaweedFS.** A reasonable choice — Apache 2.0 and the closest drop-in
replacement — but more machinery than a single-server startup needs. Revisit
if we end up with millions of small files.

**Not a managed bucket**, for now. Garage speaks S3, so moving to one later is
a configuration change, not a code change.

Garage is AGPL. We talk to it over the S3 API rather than linking against it,
so there is no copyleft reach into our code.

## 2. How it is wired

```
MediaController → StorageService → StorageAdapter
                       │              ├── S3StorageAdapter        (Garage, or any bucket)
                       │              └── FilesystemStorageAdapter (one instance only)
                       └── validation and key generation
```

**Validation lives in the service, not the adapter**, so both backends enforce
the same rules and a new backend cannot quietly relax them: a MIME allowlist
(never a blocklist) and a 10 MB ceiling.

Public upload `kind` is limited to PHOTO/COVER/LOGO images or AUDIO. It is
validated against MIME type before storage, and defaults by type when omitted.
DOCUMENT/SIGNATURE are excluded. Listing hero/share images are same-event
public image assets; selection takes share locks, and removal refuses both
listing and block references. Resizing treats LOGO and COVER like PHOTO.

**Keys are generated**, never derived from the uploaded filename — a
caller-supplied name is a path-traversal and overwrite risk.

**The adapter is chosen by configuration.** S3 whenever `S3_ENDPOINT`,
`S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are all set; local filesystem
otherwise, with a startup warning saying it is correct for one instance only.

`forcePathStyle` is required: Garage addresses buckets as a path segment, and
virtual-host style would need wildcard DNS for the S3 API.

## 3. Running it

```bash
cp garage/garage.toml.example garage/garage.toml
# fill in the two secrets it asks for: openssl rand -hex 32, twice
npm run storage:up      # starts Garage and prints credentials for .env
```

`garage.toml` is gitignored — it holds the cluster's `rpc_secret` and
`admin_token`, which are per-deployment.

That runs `scripts/garage-bootstrap.sh`, which is idempotent and does the four
things a fresh node needs:

1. **Assigns a layout.** A Garage node with no role is healthy and useless —
   this is the step that is easy to miss.
2. Creates the bucket.
3. Creates an access key **only if one does not already exist**. `garage key
   create` does not check the name, so running it twice produces two keys with
   the same alias and every later lookup fails with "2 matching keys".
4. Enables anonymous website reads (see below).

Copy the printed credentials into `backend/.env`. They are per-deployment and
are never committed.

## 4. How guests read a file

Uploads are authenticated and go through the S3 API. **Reads are anonymous**,
served by Garage's web endpoint.

That is deliberate. Invitation images are loaded by every guest from a link
they were sent:

- **Signed URLs** would expire and break an invitation already shared in a
  group chat.
- **Proxying through the API** would pay for the same bandwidth twice and put
  the API in the path of every image load.

The object key is a UUID, so the URL is unguessable without being secret —
the same posture as the invitation link itself.

In development `*.localhost` resolves, so
`http://aveline-media.web.garage.localhost:3902/<key>` works directly. In
production a reverse proxy maps a real hostname to the web endpoint, and that
hostname goes in `S3_PUBLIC_URL`. Production Caddy routes `MEDIA_DOMAIN` to
Garage's website endpoint and supplies `MEDIA_BUCKET_HOST` to select the bucket;
the S3 API and private exports are not published by that route.

## 5. Durability

**Replication factor is 1.** Durability comes from backing up `data_dir` and
`meta_dir`, not from replication. A single-node Garage is exactly as durable
as the disk under it.

Back both volumes up off-box — `restic` or `borg`, nightly. Losing them loses
every guest photo permanently, and no amount of S3 compatibility changes that.

Raise the replication factor when there is a second machine to put a replica
on; doing so on one node buys nothing.

## 6. Not yet built

- **Cropping.** Photos gain smaller WebP copies at 480, 960 and 1600 px
  (`media/image-variants.service.ts`, run by a sweep); the original is kept
  too, so resizing lowers what guests download, not what is stored
- **Public-media orphan reclamation.** Removing an upload or deleting an event removes its
  files and their copies; archiving keeps them, and nothing reclaims files no
  row points at
- **CDN** in front of the public URL
- **Virus scanning** for host-uploaded files
- **Off-host recovery configuration.** Paired quiesced capture and complete restore tooling are built; the real encrypted destination and operator alerts remain to be configured. See [DEPLOYMENT.md](DEPLOYMENT.md)
- **Public-media test isolation.** The media e2e suite writes real objects into whichever bucket
  is configured. Harmless locally, but CI needs a throwaway bucket


## Private generated artifacts

Snapshot exports use `PrivateStorageService` and opaque UUID keys. It returns
bytes or success, never a public URL or MediaAsset. When S3 is configured,
`PRIVATE_S3_BUCKET` must differ from `S3_BUCKET`; production requires it
explicitly (development/test default to `aveline-private`). Grant API/worker
read+write and disable website hosting, anonymous reads and public bucket/CDN
policies. The bootstrap script creates a separate private Garage bucket with
website access denied; it never grants anonymous access to that bucket.

Filesystem fallback uses `PRIVATE_STORAGE_ROOT` (default `./private-storage`),
outside `STORAGE_ROOT`. Both paths are checked for containment, including
symlinks on write/probe. Files use mode 0600; API and worker need the same
protected filesystem/volume. It must not sit under any Caddy/static root.
Private bytes are ignored by Git and Docker build context.

Exports have a durable write-ahead object ledger and retryable bounded cleanup
for failed attempts, deletion, erasure and expiry. Cleanup tombstones remain
as opaque metadata and repeat deletions to catch delayed stale uploads. This
does not replace the still-pending orphan reclamation for public media.
See [EXPORT_WORKER.md](EXPORT_WORKER.md). The deployment rehearsal must verify
anonymous object reads fail with the actual bucket policies.
