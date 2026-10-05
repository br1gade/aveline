# Storage

Files go through `StorageService`, never straight to disk or to a bucket.
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
hostname goes in `S3_PUBLIC_URL`.

## 5. Durability

**Replication factor is 1.** Durability comes from backing up `data_dir` and
`meta_dir`, not from replication. A single-node Garage is exactly as durable
as the disk under it.

Back both volumes up off-box — `restic` or `borg`, nightly. Losing them loses
every guest photo permanently, and no amount of S3 compatibility changes that.

Raise the replication factor when there is a second machine to put a replica
on; doing so on one node buys nothing.

## 6. Not yet built

- **Image processing.** Originals are stored as uploaded — a 6 MB phone photo
  stays 6 MB. Resizing to roughly 200 KB is a thirtyfold difference and is the
  single biggest lever on storage cost
- **Orphan reclamation.** Nothing deletes objects when an event is archived,
  so usage only grows. `StorageService.remove` exists and nothing calls it
- **CDN** in front of the public URL
- **Virus scanning** for host-uploaded files
- **Backups.** Described above; not automated here
- **Test isolation.** The e2e suite writes real objects into whichever bucket
  is configured. Harmless locally, but CI needs a throwaway bucket
