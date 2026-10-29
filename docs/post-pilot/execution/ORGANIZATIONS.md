# F38 execution blueprint — organization selection and membership lifecycle

> **Delivery update — 30 October 2026:** F38 organization-context/lifecycle backend is now implemented; additional-membership activation and frontend/operational cutover remain gated.
> See [current implementation status](IMPLEMENTATION_STATUS.md). The remainder is
> the historical 25 October blueprint: “NOT IMPLEMENTED”, “NOT EXECUTED”, “NOT RUN”
> and proposed-command labels describe that planning pass, not today's backend.
> Superseded route/runtime details defer to [API.md](../../API.md), generated
> [OpenAPI](../../../backend/openapi.json) and the linked governing domain docs.
> Planning commands are not proof of execution or approval to run a real cutover.


**Historical planning record.** Prepared against `bb01a61` on `codex/post-pilot-backend`, 25 October 2026. No implementation, migrations, tests, providers or deployments were run during that planning pass. All new symbols, tables and endpoints below are **unimplemented proposals**. Relative links assume this document is eventually placed at `docs/post-pilot/execution/ORGANIZATIONS.md`.

Authority: [PP-D44–49](../DECISIONS.md), [organization proposal](../ORGANIZATIONS_DESIGN_AND_OPERATIONS.md), [delivery plan](../../POST_PILOT_IMPLEMENTATION_PLAN.md), [current access policy](../../ACCESS_CONTROL.md), [current HTTP contract](../../API.md), [backend rules](../../../backend/CLAUDE.md), and [feature workflow](../../../.claude/skills/feature/SKILL.md). The interview is complete; transport, DTO and concurrency choices here are engineering decisions implementing it. No new entitlement limits, financial authority, cross-organization corporate grants or customer-contact exposure are introduced. A customer membership exit revokes customer-derived rights while independent platform permissions remain governed by their own policy. Initial single-payer F37 can ship independently.

## 1. Starting state and exhaustive membership-reader inventory

`OrganizationMembership.userId @unique` is the current safety barrier. Keep it until every reader and writer below has migrated. Removing it alone enables cross-tenant privilege borrowing.

| Exact source / function | Current assumption or adjacent hazard | Required change before activation |
|---|---|---|
| [schema](../../../backend/prisma/schema.prisma), `OrganizationMembership` | Unique `userId`, plus existing unique `(userId,organizationId)` | Retain membership IDs/composite uniqueness/FKs. Later drop only the single-user unique index. |
| [AuthGuard](../../../backend/src/infra/auth/auth.guard.ts), `organizationRoleOf`, `standingOf`, `resolveActor`, `eventIdFrom` | `findFirst({userId})` chooses arbitrary tenant. `eventIdFrom` guesses `params.id` even without metadata. | Shared selector resolver; explicit route metadata on new APIs; no first-row default. Event lookup remains exact resource tenant. |
| [actor.ts](../../../backend/src/infra/auth/actor.ts), `RequestActor`, `OrganizationScope`, `actorCan` | Organization context not distinguished from request selection; comments assume caller cannot select | Add resolved context/source, scoped metadata modes and transaction-aware reauthorization; retain existing fields and policy union. |
| [OrganizationsService](../../../backend/src/modules/organizations/organizations.service.ts), `create/current/rename/describe` | `create` checks first membership and relies on uniqueness. `describe` includes subscription metadata | Create becomes idempotent and independent of prior memberships. Current/rename require resolved organization. Minimal membership selector never reuses `describe` or exposes its plan fields to nonbilling members. |
| [OrganizationsController](../../../backend/src/modules/organizations/organizations.controller.ts), `create/current/rename` | Create has `@OrganizationScope()` although creation must work before any tenant is selected | Remove scope from create. Current/rename use required selection. Add lifecycle routes below. |
| [AccountService](../../../backend/src/infra/auth/account.service.ts), `acceptInvite/assertNoOtherOrganization/prepareInvitee` | Explicit second-org denial; transaction uses invite role captured before its claim; upsert overwrites existing role; prepared existing user can deactivate/reset before commit | Remove denial only behind activation gate; reread invite and user under locks; preserve existing membership role; recheck password/session generation and activity; use same-user repeat acceptance contract. |
| Same file, `inviteMember/revokeInvite/listInvites`, `inviteToEvent/acceptEventInvite/revokeEventInvite` | Member check and invite rotation are separate writes; event acceptance could restore a direct role after organization exit | Transactional current authority and token rotation; revoke pending org/event invites at exit; acceptance participates in org/event/invite/current-user locks. Both organization and event token paths matter. |
| [InvitesController](../../../backend/src/infra/auth/invites.controller.ts), `list/invite/revoke/accept/acceptEventInvite` | Legacy selected-org routes; public token acceptance | Preserve legacy selected-org routes and credential proof. Accept uses invite target, never browser selection. New authenticated accept can be added later; unnecessary for F38. |
| [ConciergeService](../../../backend/src/modules/organizations/concierge.service.ts), `openForCustomer/createEvent/find` | Owner-email `findFirst`; create organization then invite outside one transaction; staff need no membership | 0/1/many resolver below, explicit target when ambiguous, atomic organization+invite+transactional Message outbox. Keep staff search staff-only and bounded. |
| [EventsService](../../../backend/src/modules/events/events.service.ts), `creatorRole/create/findAll` | `creatorRole(tx,userId)` reads any organization; list currently selected org plus all direct event memberships; staff all events | `creatorRole(tx,userId,organizationId)` exact composite lookup under creation authority locks. Preserve list contract below. Never use an unrelated OWNER role. |
| [TeamService](../../../backend/src/modules/events/team.service.ts), `lockedMember/changeRole/remove/assertAnotherOwner` | Event first, no actor argument, owners counted without active-user qualification | Organization access fence before existing event lock, current actor authorization; maintain last direct event OWNER protection. |
| [seating-access](../../../backend/src/modules/seating/jobs/seating-access.ts), `requireSeatingAccess`; [seating jobs](../../../backend/src/modules/seating/jobs/seating-jobs.service.ts), `create`; [runner](../../../backend/src/modules/seating/jobs/seating-runner.ts), `capture/apply` | Already filters organizationMemberships by exact event tenant; `[0]` is safe because predicate + composite unique. Existing event→user lock order conflicts with naïve user-first exits | Retain scoped lookup and existing event→User→role lock order; prepend org SHARE fence before event lock and recheck before apply. |
| [export-access](../../../backend/src/modules/exports/export-access.ts), `exportAccess`; [snapshot service](../../../backend/src/modules/exports/export-snapshots.service.ts), `create/assertDownload/download`; [runner](../../../backend/src/modules/exports/export-runner.ts), `capture/publish/assertMayRun` | Tenant-filtered `[0]` is safe; current exportAccess does not lock standing; download already checks after storage I/O | Use common current event authorization, add org/share and current standing fences during capture/publish and queue intent; preserve pre/post-I/O download checks and contact redaction. |
| [privacy erasure](../../../backend/src/modules/privacy/erasure.ts), `eraseSubject/withdrawInvites/closeAccount`; [export privacy](../../../backend/src/modules/exports/export-privacy.ts), `revokeSubjectExports/lockExportPrivacy` | closeAccount deactivates/anonymizes user late and keeps role links; erasure is platform-wide, not selected tenant | Keep invitation-withdrawal then account-deactivation ordering; close every membership's authority via user activity, cancel account jobs and withdraw invitations across all orgs/events. Preserve tombstone ownership/history; reconcile ADMIN recovery reviews after commit. |
| [access policy](../../../backend/src/modules/access/access-policy.ts) | `CUSTOMER_OWNED` automatically grants OWNER permissions outside `PLATFORM_ONLY` | No new broad permission for F38. Future `template:*`, `enquiry:*` staff grants enter PLATFORM_ONLY in their own slices. |

`rg -n 'organizationMembership|organizationMemberships|one organization|single.organization|one per account' backend/src backend/test backend/prisma` is the mandatory repeatable inventory at implementation time. At this revision the runtime first-membership reads are precisely guard, organization create, account second-org denial, concierge owner-email lookup and creatorRole. `inviteMember`/`inviteToEvent` first-row checks are exact target/email existence queries, not arbitrary organization selection. Filtered arrays in seating/exports remain legitimate. Do not mechanically replace every `findFirst`.

All current organization-scoped controller consumers, verified from decorators:

| Controller | Functions/routes requiring one shared resolution |
|---|---|
| OrganizationsController | `current/rename`: `GET/PATCH /organizations/current`; `POST /organizations` becomes session-only |
| EventsController | `findAll`: `GET /events`; `create`: `POST /events` |
| InvitesController | `list/invite/revoke`: `GET/POST /organization/invites`, `DELETE /organization/invites/:email` |
| [SubscriptionsController](../../../backend/src/modules/billing/subscriptions.controller.ts) | `GET/POST /subscription`, `POST /subscription/cancel`, `POST /subscription/resume`, `GET /invoices`, `GET /invoices/:number`, `POST /invoices/:number/confirm` |
| [PromoCodesController](../../../backend/src/modules/billing/promo-codes.controller.ts) | list/create/update/deactivate: `/promo-codes`, `/promo-codes/:codeId` |
| [VendorsController](../../../backend/src/modules/vendors/vendors.controller.ts) | `listVendors/createVendor`: `GET/POST /vendors`; retain curated-list staff case separately |
| [SuppressionsController](../../../backend/src/modules/privacy/suppressions.controller.ts) | `list/suppress/unsuppress`: `/suppressions`, `/suppressions/:suppressionId` |

Every identifier lookup inside those services must retain organization predicates (invoice, promo, private vendor and suppression IDs cannot select another tenant). Event/invitation/listing controllers derive tenant through event IDs/slugs; nested guest/asset/booking IDs still require event predicates. New staff resource paths use `:enquiryId`/`:templateId`, not an unannotated `:id` that AuthGuard currently guesses as an event.

Two existing discrepancies must be recorded explicitly, not silently resolved: EventsController Swagger says every creator becomes OWNER although creatorRole gives organization MANAGER a COORDINATOR role; and organization/team-owner prose can imply a direct event OWNER always exists although manager-created and concierge-created events may have none. Preserve current D9 role behavior, correct API prose in its implementation commit, protect the last **existing direct OWNER** from removal, and do not fabricate owner memberships for legacy zero-owner events. Their organization OWNER/platform ADMIN remain authoritative through existing policy.

## 2. Selected engineering transport and exported actor contract

Use the optional HTTP header `X-Aveline-Organization-Id`. It selects a tenant; it never grants a role. No mutable server default or JWT organization claims. Frontend stores the ID in per-tab state (`sessionStorage` or equivalent), validates by requesting current organizations, and attaches it only to organization-scoped calls. Tabs remain independent. Logout clears local selection; revoked/closed selection prompts reselection. Refresh tokens need no tenant-specific issuance.

Header parser, only on organization/event-scoped routes: single scalar string, 1–64 ASCII `[A-Za-z0-9_-]` characters. Reject empty, repeated headers (inspect raw headers), arrays, comma-joined values, whitespace and oversize with field `organizationId`. This accepts existing opaque IDs without committing the API to one CUID generation. Explicit path organization IDs use the same validator. Reject conflicting path/header with `409 ORGANIZATION_CONTEXT_MISMATCH`; no query/body alias to this header. Unknown `organizationId` query on legacy `GET /events` continues to be ignored, never gaining authority.

Proposed exports in `backend/src/infra/auth/organization-context.ts`:

```ts
interface OrganizationContext {
  organizationId: string;
  organizationRole: OrganizationRole | null;
  source: 'header' | 'sole-membership' | 'event' | 'route';
  access: 'membership' | 'event' | 'platform';
}
interface OrganizationResolution {
  userId: string;
  platformRole: PlatformRole;
  selector?: string;
  eventId?: string;
  routeOrganizationId?: string;
  mode: 'required' | 'event-list' | 'event' | 'platform';
  platformPermission?: Permission;
}
// prisma root client or caller's TransactionClient; caller owns transaction.
resolveOrganizationContext(tx, input): Promise<OrganizationContext | null>;
resolveCustomerOrganizations(tx, normalizedEmail, selectedOrganizationId?): Promise<
  { kind: 'none' } | { kind: 'one'; organizationId: string } |
  { kind: 'selection-required' }
>;
```

`RequestActor` retains `userId,email,platformRole,organizationId,organizationRole,eventId,eventRole`; add `organizationContext?: OrganizationContext|null`. Keep `actorCan` pure role union. Do not pass a client-created context into services; authenticated identity plus resource IDs are re-resolved when performing fenced writes. Event-only collaborators receive `access:'event',source:'event',organizationRole:null`. An ID-only selection does not satisfy membership authorization.

Resolver modes are explicit route metadata, not inferred from whether a parameter happens to be called `id`. Session-only/global staff routes bypass organization resolution. `@OrganizationScope()` defaults to required; `GET /events` uses event-list; privileged target-org authoring routes opt into platform mode with an explicit platform-only permission and resource check. F39 uses session/platform actor plus assignment; F44 global authoring uses platform actor and private authoring additionally validates target organization. They work while one-org uniqueness remains. The shared helper is a compatibility slice, not a dependency on multi-membership activation.

Selection truth table (after authentication and actual-resource permission checks; public capability routes unchanged):

| Request | Result |
|---|---|
| Customer required-org route, absent selector, 0 live memberships | `403 ORGANIZATION_ACCESS_DENIED`, recovery create/join organization; no empty-string FK calls |
| Customer absent selector, exactly 1 live membership | That organization/role (`sole-membership`), existing HTTP response shapes |
| Customer absent selector, 2+ live memberships | `409 ORGANIZATION_SELECTION_REQUIRED`; no write; fetch own membership selector |
| Supplied selector, current membership in open org | Exact composite lookup, use only target role |
| Supplied unknown/foreign/revoked/closed org | Same `403 ORGANIZATION_ACCESS_DENIED`, no existence/tenant details |
| Event route, absent selector, any membership count | Load actual event tenant; exact org membership + exact event membership + platform role |
| Event route, selector equals event tenant | Same event-derived standing; event-only role remains usable without org membership |
| Event route, authorized actual resource but mismatching selector | `409 ORGANIZATION_CONTEXT_MISMATCH`; no automatic switch, no other organization's role/name in error |
| Missing event/resource | Existing resource-not-found/denial convention; no fallback to selected tenant; never make this a tenant probe |
| Session-only membership list/create or invite-token acceptance | Selection not required; these routes do not consume selector header; acceptance targets token's tenant, never header |
| Staff tenant operation | Explicit selector/path chooses existing open org, then current platform permission and resource scope authorize; context org role stays null unless actual membership exists |

Staff exception is route-specific: SUPPORT can operate an explicit event through current event permissions and concierge through `concierge:manage`, but a target selector never grants SUPPORT billing/member-management permission. ADMIN may target an explicit org for existing ADMIN-granted operations. No selector and no staff membership on tenant writes returns `409 ORGANIZATION_SELECTION_REQUIRED`, rather than passing `''` to a service. Staff with one own membership can retain its legacy default on legacy tenant routes; staff with several own memberships gets ambiguity. F44 assignment does not fabricate membership or general SUPPORT browsing.

`GET /events` keeps its current array response: selected organization's readable events **plus every directly granted event**, deduplicated by a single SQL OR query. No-membership users with no header get their directly granted events (possibly `[]`). Customers with several memberships must select. This intentionally means a direct event from another org may appear, with its existing `organizationId`; its linked event route derives tenant. No implicit cross-org organization-event aggregation. Staff with no header keeps its existing paginated all-platform event list independently of membership count; explicit header narrows to that tenant plus their own direct event grants, and platform permission still applies. Existing `archived`, limit 1–500 and offset bounds remain. Preserve existing event-list bounds and pagination: staff defaults to 100, customer default remains unbounded as currently implemented, and supplied limit remains 1–500. This slice bounds only the new membership selector; any future customer-event pagination change needs its own explicit client contract.

`GET /vendors` needs explicit mode: staff no-header/no-membership preserves curated-only list and staff `POST /vendors` no context preserves curated creation. With a validated tenant context, list curated+tenant and create tenant-owned private vendor. Staff with memberships uses sole-membership legacy behavior unless explicitly using a future curated route; no broad SUPPORT tenant scan is added.

New own-membership route, all roles, no contacts/billing/history:

```http
GET /api/v1/me/organizations?limit=50&cursor=<opaque>
Authorization: Bearer <access>
```
```json
{"items":[{"organizationId":"cmorgA","name":"Family Event","kind":"HOST","role":"OWNER","joinedAt":"2026-10-25T00:00:00.000Z"}],"nextCursor":null}
```

Query default 50, max 100, cursor at most 256 characters (validated encoded createdAt+id); sort by membership createdAt,id; return only active caller memberships in nondeleted organizations. Header unnecessary. A selection-required error returns no organization list, count, names or customer details. This route provides authorized choices in a separate bounded request.

Existing errors use `AllExceptionsFilter` + `localizeHttpError`, which currently discards custom HttpException fields and derives all 409 codes as CONFLICT. Add a typed `DomainHttpException` allowlist and preserve specific code/action through the filter; do not assume throwing `{code:...}` works today. Extend `feedback-copy.ts`, `feedback.dto.ts`, `localized-feedback.ts` for four languages. Example:

```json
{"statusCode":409,"message":"organizationId: select an organization for this action","code":"ORGANIZATION_SELECTION_REQUIRED","locale":"en","userMessage":"Select an organization to continue.","action":"SELECT_ORGANIZATION","details":[],"requestId":"req-123","path":"/api/v1/subscription","at":"2026-10-25T00:00:00.000Z"}
```

Other specific codes: `ORGANIZATION_CONTEXT_MISMATCH` (409, SELECT_ORGANIZATION), `ORGANIZATION_ACCESS_DENIED` (403, REQUEST_ACCESS), `OWNER_HANDOVER_REQUIRED` (409, HAND_OVER_OWNERSHIP), `IDEMPOTENCY_KEY_REUSED` (409), `REVISION_CHANGED` (409, RELOAD). Invalid header is existing 400 VALIDATION_FAILED with details field `organizationId`. Errors do not echo foreign org names or the invite token. Add explicit header/idempotency CORS preflight coverage in `application.ts` and proxy/edge config; keep origin restrictions. OpenAPI declares header per applicable route, not guest routes.

## 3. Data additions and safe migration stages

No default organization column and no membership-array blob on User. Preserve existing organization/event IDs and all financial/accepted evidence.

Minimal additions:

* `Organization.accessRevision Int` (final NOT NULL/default 0): optimistic concurrency for role/exit operations; increments in each membership lifecycle mutation. No entitlement semantics.
* `OrganizationInvite.acceptedByUserId String?` and `EventInvite.acceptedByUserId String?`, FK to User `ON DELETE SET NULL`, for safe proven repeat acceptance. Leave historical consumed rows null; do not infer the historical accepter from today's email/membership. New issue resets it null and rotates hash. Current `(organizationId,email)` / `(eventId,email)` and tokenHash uniqueness stay.
* `OrganizationCreateIntent(actorUserId,key,fingerprint,organizationId,createdAt)`; composite PK `(actorUserId,key)`, FK actor user and organization `ON DELETE RESTRICT`, fingerprint SHA-256 hex, key max 120. Never expose key/fingerprint outside caller result. Preserve records while organization exists; do not invent a retention interval. Same key+canonical validated name/kind returns same organization; differing fingerprint 409. No key creates distinct organization only once multi-org is enabled; clients should send keys to protect network retries.
* `OrganizationAccessReview(id, organizationId, subjectUserId, kind, status, createdAt, resolvedAt, resolvedByUserId)` for ADMIN-only recovery/closure review, no free-text PII and no hard-coded financial retention. Kinds `LAST_OWNER_CLOSURE`, `INACTIVE_OWNER_RECOVERY`; statuses OPEN/RESOLVED/DECLINED; partial unique pending review `(organizationId,subjectUserId,kind)` prevents duplicate requests. Review submission does not itself close a tenant. F38 supplies a review queue; an ADMIN records reviewed handover or closure using the guarded operation described below, rather than removing last OWNER through ordinary membership removal.

Migration directories: `20261026xxxx00_organization_context_compat`, `20261026xxxx01_organization_lifecycle`, `20261026xxxx02_multiple_memberships`. Generate actual timestamps during coding; never edit old `20261009160000_access_and_vendors`.

Representative migration SQL, to generate/review before running:

```sql
-- Stage A, while existing unique userId remains.
ALTER TABLE organizations ADD COLUMN "accessRevision" INTEGER;
UPDATE organizations SET "accessRevision" = 0 WHERE "accessRevision" IS NULL;
ALTER TABLE organizations ADD CONSTRAINT organizations_access_revision_valid
  CHECK ("accessRevision" IS NOT NULL AND "accessRevision" >= 0) NOT VALID;
ALTER TABLE organizations VALIDATE CONSTRAINT organizations_access_revision_valid;
ALTER TABLE organizations ALTER COLUMN "accessRevision" SET DEFAULT 0;
ALTER TABLE organizations ALTER COLUMN "accessRevision" SET NOT NULL;
ALTER TABLE organization_invites ADD COLUMN "acceptedByUserId" TEXT;
ALTER TABLE event_invites ADD COLUMN "acceptedByUserId" TEXT;
ALTER TABLE organization_invites ADD CONSTRAINT organization_invites_accepted_by_fkey
  FOREIGN KEY ("acceptedByUserId") REFERENCES users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE organization_invites VALIDATE CONSTRAINT organization_invites_accepted_by_fkey;
ALTER TABLE event_invites ADD CONSTRAINT event_invites_accepted_by_fkey
  FOREIGN KEY ("acceptedByUserId") REFERENCES users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE event_invites VALIDATE CONSTRAINT event_invites_accepted_by_fkey;
CREATE INDEX organization_memberships_user_created_id_idx
  ON organization_memberships("userId", "createdAt", id);
CREATE INDEX organization_memberships_organization_role_idx
  ON organization_memberships("organizationId", role);
CREATE INDEX event_memberships_event_role_idx ON event_memberships("eventId", role);
CREATE INDEX events_organization_starts_id_idx
  ON events("organizationId", "startsAt", id);
-- Stage B: new empty tables; new NOT NULL fields are safe on these tables.
CREATE TABLE organization_create_intents (
  "actorUserId" TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 120 AND key ~ '^[A-Za-z0-9_-]+$'),
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("actorUserId", key)
);
CREATE TABLE organization_access_reviews (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "subjectUserId" TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('LAST_OWNER_CLOSURE','INACTIVE_OWNER_RECOVERY')),
  status TEXT NOT NULL CHECK (status IN ('OPEN','RESOLVED','DECLINED')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" TEXT REFERENCES users(id) ON DELETE RESTRICT,
  CHECK ((status = 'OPEN' AND "resolvedAt" IS NULL AND "resolvedByUserId" IS NULL)
    OR (status <> 'OPEN' AND "resolvedAt" IS NOT NULL AND "resolvedByUserId" IS NOT NULL))
);
CREATE UNIQUE INDEX organization_access_reviews_pending_key
  ON organization_access_reviews("organizationId","subjectUserId",kind) WHERE status='OPEN';
CREATE INDEX organization_access_reviews_status_created_id_idx
  ON organization_access_reviews(status,"createdAt",id);
CREATE TABLE runtime_compatibility (
  id TEXT PRIMARY KEY,
  "minimumRevision" INTEGER NOT NULL CHECK ("minimumRevision" >= 1),
  "multiOrganizationWrites" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO runtime_compatibility(id,"minimumRevision","multiOrganizationWrites")
  VALUES ('organization-context',2,false);
-- Stage C only after old-process exclusion and populated rehearsal proof.
DROP INDEX "organization_memberships_userId_key";
```

`organization_invites`/`event_invites` table names must match their existing `@@map`, verified when generating SQL. Use populated fixture rows and migration introspection, not an empty-schema-only test. Existing `(userId,organizationId)` unique index already provides a left-prefix user lookup; the added user+createdAt+id index serves real paginated selection order, not a redundant workaround. Owner indexes serve owner count checks. Event list index serves selected tenant chronology. Preserve `users_email_lower_key`, all capability token uniqueness and membership composite keys. Do not remove old org-only/event-only indexes without query-plan evidence. Large deployed tables would require separate concurrent-index operations outside Prisma transactional SQL; this project is local, but record lock/statement timeouts and the chosen mechanism in the migration runbook.

Deployment gates are separate from schema:

1. Compatibility release understands selector modes and every reader above; `MULTI_ORGANIZATION_WRITES=false` still retains old create/join denial. Lifecycle endpoints and resolver tests can ship before schema uniqueness removal. Extra organization creation is not available until full cutover.
2. Additive schema/indices and updated Prisma client; existing rows retain meaning. Add the database-backed schema contract row `runtime_compatibility(id='organization-context', minimumRevision=2, multiOrganizationWrites=false)`; use the explicit maintenance cutover below in addition to that gate. New API and standalone workers check minimum revision at startup **and** gate dangerous writes transactionally (lock the compatibility row FOR SHARE for each create/join transaction; operator updates wait for in-flight writes). A new-code check cannot make an old binary understand new schema.
3. Stop all API/job/scheduler processes; close public traffic; verify deployment inventory/image digests and no old DB clients. Revoke old deployment database credentials and terminate sessions if old replicas cannot be conclusively excluded. This is what prevents old readers, not an environment flag that old code ignores. Apply unique-index drop; start only revision-2 processes and verify health/schema compatibility. Keep write flag false until smoke/regression evidence is checked.
4. Enable multi-org writes atomically through shared PostgreSQL gate (all instances read inside create/accept transactions). No local environment toggle races. Existing single-org readers remain safe because they are already selector-compatible. API response reports actual organization IDs; no guessed preference backfill.

Before the first second membership, rollback may disable writes and recreate single-user unique index after proving `GROUP BY userId HAVING count(*)>1` empty. After any second membership, never run old binaries or recreate uniqueness by deleting rows; disable additional creates/joins and roll forward. Compatibility release can serve multiple memberships even with new writes disabled. Restoring an old backup into production loses later authority/history and is disaster recovery, not routine rollback. Document the cutover timestamp and irreversible point.

## 4. Concurrency contract: exact fences and writer obligations

Use real PostgreSQL rows, not Redis locks. Proposed helpers `lockOrganizationStanding`, `lockCurrentUsers`, `requireCurrentEventPermission` live in `backend/src/infra/auth/access-locks.ts`. Input is one bounded operation descriptor (max four function parameters); caller supplies transaction. Reuse `actorCan` for current permission, not job-captured roles.

**Smallest safe protocol: one organization access fence, preserving existing domain lock chains.** Leave/remove changes memberships, so it does **not** need target User UPDATE. Existing seating role-row SHARE locks already make deletions wait, but cannot lock a missing role row or stop event invite acceptance creating a new role after the remover enumerates events. Organization fencing supplies that aggregate boundary; no universal user-first rewrite is justified.

1. Export privacy fence stays first **only when already touched**: capture/publish SHARE, erasure exclusive/update. No new org/user acquisition is inserted ahead of this existing global fence.
2. Target Organization row: `FOR NO KEY UPDATE` for org membership/OWNER change, leave/remove and reviewed closure; `FOR SHARE` for event-member grants/changes/invites, event creation and actor-authorized worker queue/capture/apply/publish. Event routes discover actual org, lock it, then reread relation under event lock; events do not change org in F38. F38 lifecycle transactions affect one org; future multi-org operations must sort IDs.
3. Event rows sorted by ID where needed. Preserve seating's existing event UPDATE before User SHARE. Departure enumerates direct role events after org UPDATE, so concurrent grants cannot appear: every grant needs org SHARE first.
4. Invitation rows touched, in deterministic table/key order where a set is needed, **before** current User SHARE checks. Org fence serializes same-org invite writers. Accept locks/claims invite before locking/rechecking existing invitee User, agreeing with legal erasure's existing `withdrawInvites` before `closeAccount` User update. Never take User SHARE and then wait for an invite addressed to that same user: that would invert erasure.
5. Current actor/successor/invitee User SHARE, sorted if several, then membership rows and domain job/artifact rows. No User UPDATE for membership changes. Recheck activity/current roles and active successor. Existing seating keeps User SHARE → event-membership SHARE → org-membership SHARE. Password/deactivation writers naturally conflict with User SHARE and need no org lock.
6. Preserve downstream event attendance policy → ticket order → guest → ticket and seating arrangement/input order. No new helper acquires org/user/role locks for the first time after these domain locks. Creating an entirely new organization has no existing aggregate to fence; its identity/intent constraints do not lock an old org.

Implementation refinement: organization IDs never change, so lifecycle/recovery
use PostgreSQL `FOR NO KEY UPDATE` rather than `FOR UPDATE`. It still conflicts
with role/worker `FOR SHARE`, but permits implicit FK `FOR KEY SHARE` acquired by
privacy suppression inserts after invitation locks. A stronger org row lock would
create org→invite / invite→org cycles with verified erasure. Deterministic tests
exercise invitation-before-FK insertion and SHARE exclusion. References below to
an org UPDATE fence mean this non-key-changing aggregate exclusion.

F39 integration adds an owner-address identity boundary, not a second organization resolver. Self-create, concierge setup and invitation acceptance that can race owner setup acquire the same canonical owner-address advisory lock before any organization/invitation/current-user lock. Use `resolveCustomerOrganizations(tx,input)` for explicit 0/1/many resolution. Enquiry conversion can lock its own command/case before the organization prefix; F38 never locks an enquiry after taking organization/User locks, and verified enquiry erasure never acquires an organization fence. Credential-bearing invitations use the same `enqueueInTransaction` Message helper described below. Implement and test these shared seams once; neither lane introduces a duplicate resolver or outbox.

Concrete avoided cycle: leave holds org UPDATE then waits Event, while worker holds Event then asks org SHARE. Therefore prepend org SHARE to seating enqueue/capture/apply and event-role writers **before** their event lock. This is a narrow required change. Export capture/publish becomes privacy SHARE → org SHARE → current User SHARE/roles → job/artifact. Privacy acquires no org fence while holding invite/user/order/guest locks. Account closure keeps existing-style legal-erasure handling; review rows/FKs are reconciled after commit, avoiding accidental user→org waits.

When a viable successor/other OWNER is needed, lock that selected existing active user SHARE and recheck it after aggregate fence, so ordinary removal cannot rely on a concurrently deactivated owner. A later verified erasure remains an exceptional recovery-review path. Org UPDATE protects org OWNER counts; Event UPDATE protects direct event OWNER counts. Org SHARE prevents departure during accepted worker commits; exact role rows remain locked where seating already requires it. Inactive tombstone roles do not satisfy viable-successor checks. Legacy zero-direct-owner events are not rewritten.

Mandatory conversion: organization create/rename and new lifecycle operations; event create/creatorRole; org/event invite issue/rotation/revoke/accept; TeamService change/remove; seating queue/capture/apply; export queue/capture/publish. Privacy gains all-membership account recovery/worker coverage and after-commit review reconciliation, preserving existing export/privacy/invite/User order. Audit reset/deactivate/register/admin repair paths for no org acquisition after User locks. Raw membership SQL follows org fence or runs with traffic stopped. Existing unrelated sync guard checks retain next-request semantics, not a newly claimed global commit-time guarantee.

Host admission audit: [check-in service](../../../backend/src/modules/guests/check-in.service.ts), [TicketingService.admit](../../../backend/src/modules/ticketing/ticketing.service.ts), [admission helpers](../../../backend/src/modules/guests/admission.ts), attendee linking/cancellation and RSVP attendance writers keep their event policy → order → guest → ticket chain. **Do not change these chains for F38.** They neither mutate memberships nor take the new org fence. If future host admission needs strict commit-time permission, prepend org SHARE/current authority in callers; never add a late User/org lock inside `lockAdmission`/`undoAdmission`. Capability callers take no host actor locks. F38 cannot retract already-sent bytes or cancel all sync operations begun before exit.

No locks across bcrypt/SMTP/storage/CPU. Verify/hash outside; under User SHARE compare current passwordHash/sessionGeneration/activity to proven snapshot. Bound transaction timeout/maxWait and retry serialization/deadlock with fresh reads; never repeat external effects. Bulk invitation deletion and privacy's existing deleteMany can still contend: use deterministic row locking for touched sets and real PostgreSQL race tests, rather than claiming all unrelated old helpers are deadlock-free. Departure uses set-based deletes and group counts; no per-event query loop. If measured work exceeds request budget, refuse unchanged for ADMIN remediation; never partially revoke or invent entitlement limits.

## 5. Operation algorithms and route/DTO proposals

This section records the route/DTO engineering specification; consult the current API contract and implementation for exact response/model shapes. Base `/api/v1`. UTC dates; no user email in a tenant selector response. IDs 1–64 as above; UUID-like idempotency key 1–120 `[A-Za-z0-9_-]`; `expectedRevision` integer 0–2^31−1; enum role validation. Existing name 2–160, kind `HOST|PLANNER|CORPORATE`, normalized email max 200, invite token 32–200, password 10–200, name 2–120 remain. No array of arbitrary organization IDs or PII-bearing notes.

**Create, existing `POST /organizations`.** Session-only, selection-independent; supplied header cannot affect target or inherited privileges. Optional `Idempotency-Key` initially preserves old-client compatibility. Validate DTO/hash outside transaction; lock actor User UPDATE and recheck activity before create-intent and new-organization writes. This UPDATE serializes create requests while the compatibility write gate is false after unique-index removal; it locks no pre-existing organization, so it does not impose a user→existing-org inversion. Under false write gate, query existing org memberships inside that User UPDATE transaction and retain one-org denial; under true gate prior memberships do not deny. Claim `(actor,key)` and compare normalized request fingerprint; an existing intent requires current membership/read access before returning organization details (a departed creator cannot recover billing through replay); create Organization + OWNER membership + intent link in same transaction, return existing description shape (plan permissible because creator is OWNER) with additive `accessRevision`. Distinct keys represent distinct intents; same key different body 409. Org creation never copies subscription, role, events or plan eligibility from another organization. Staff creating their own customer org uses this same membership path; acting for someone else uses concierge.

```http
POST /api/v1/organizations
Idempotency-Key: create_family_01
Content-Type: application/json

{"name":"Family Event","kind":"HOST"}
```
```json
{"id":"cmorgB","name":"Family Event","kind":"HOST","events":0,"members":1,"plan":null,"subscriptionStatus":null,"accessRevision":0,"createdAt":"2026-10-25T00:00:00.000Z"}
```

**Invite issue/revoke, existing `/organization/invites`.** Selected tenant `member:manage`; current OWNER/platform ADMIN permission rechecked inside txn. Lock organization; lock current invite row if present; then current actor/recipient users SHARE sorted; reject existing member without altering their role; rotate one target org/email row and insert the deduplicated existing Message outbox row in the same transaction. Do not enqueue with existing `CommunicationsService.enqueue` as if it joined the transaction—it does not. Implement `CommunicationsService.enqueueInTransaction(tx, params)` first: template/suppression/message reads and deduped inserts use that TransactionClient; provider dispatch remains after commit. Do not catch a unique violation and continue querying an aborted Postgres transaction: use createMany(skipDuplicates)+exact dedupe lookup, or conflict-safe SQL. Account invite writers call this method inside their transaction; current external enqueue remains for callers not requiring atomicity. Store only token hash in invitation; raw link must reach email without becoming an exposed persistent notice field. A transactional outbox containing a credential needs the existing protected message/retention boundary, not a new plaintext audit log. Return queued acceptance, never claim SMTP delivery. Add an integration rollback test proving organization/invite/message all disappear on failure, and a privacy-withdrawal race proving obsolete invite tokens cannot dispatch a usable grant; redact the existing message payload through current privacy handling. Revoke participates in same locks, canonicalizes email, atomically invalidates current token. Staff no implicit membership added.

**Accept, existing public `POST /invites/accept` / `/event-invites/accept`.** Continue existing password proof; no unauthenticated tenant lookup/list. Read invite hash to identify target; verify validity and password outside locks; lock org first, event if applicable, then current invite row; lock/recheck existing user SHARE after invite row or create new user inside that transaction (case-insensitive unique email remains). Reread current invite hash/revocation/expiry/role under locks; token rotation since lookup invalidates it. Recheck proven user's activity/passwordHash/generation. Conditional claim includes tokenHash and unconsumed/unrevoked/unexpired state. While multi-org writes are false, take invitee User UPDATE instead of SHARE and recheck other memberships inside that transaction, preserving one-org safety after index drop. While true, User SHARE is sufficient. Create membership only if absent; existing membership retains its current role. Write acceptedByUserId with acceptedAt; role is taken from locked invite, not earlier object. Increment accessRevision on new org membership. Account creation, claim and membership are one transaction. Concurrent registration collision rolls back the whole transaction; require fresh proof of existing account, never attach a precomputed new-account password to it.

Repeated same unexpired token + correct account password + `acceptedByUserId` same user returns `{ok:true,organizationId,role:<current>,accountCreated:false}` without recreating membership or overwriting role. If revoked/rotated/expired use normal invalid invitation; if acceptedBy matches but membership removed return existing 400 invalid-invitation shape, never rejoin. Invalid/revoked/expired/consumed legacy invite routes retain their existing 400 semantics; no new 410 contract is introduced. Historical accepted rows with null accepter remain nonreplayable. Two simultaneous accept requests produce one membership and compatible results; distinct org invites can both join only after activation. Fresh acceptance after an exit requires a newly issued token; old pending event invites have been revoked. A later newly authorized direct event invite may grant event-only access again; PP-D49 is revocation, not a permanent ban.

**List/change members.** `GET /organizations/current/members?limit=50&cursor=...` uses selected org + member:manage; return IDs/name/role/joinedAt with no email by default (invite controller already manages recipient email separately). Max 100, cursor 256; includes accessRevision once. `PATCH /organizations/current/members/:userId` body `{role,expectedRevision}` changes exact target membership under org UPDATE and current actor/successor User SHARE checks; missing target 404 only after tenant authorization. OWNER demotion requires another active org OWNER, else 409. Changing org role does not erase direct event roles; actual leave/remove does.

**Ownership handover.** `POST /organizations/current/owner-transfers` body `{successorUserId,expectedRevision}`; successor must already be active member of target organization, no invitation grants authority before acceptance. Under org UPDATE and actor/successor User SHARE checks, recheck member:manage and revision, promote successor to OWNER. Caller remains OWNER, so a retry cannot accidentally demote them; promotion then leave is two explicit user intents, and removal rechecks protection. Response `{organizationId,successorUserId,role:"OWNER",accessRevision}`. Last-event-owner handover uses existing event team role update on a current active event member; it needs current event member:manage and same fence protocol. Do not auto-promote arbitrary org members into event teams without authorized event intent.

**Self leave.** `POST /organizations/current/leave`, body `{expectedRevision}`; any current member may self-leave (do not RequirePermission member:manage). **Remove.** `DELETE /organizations/current/members/:userId?expectedRevision=N`, current member:manage required and target membership must belong to selected org. Keep paths explicit rather than infer user target from body email. Both call one `removeOrganizationAccess(tx,descriptor)`:

1. Lock org UPDATE and read current actor/target membership, open state and expected revision. Guard authorization has already rejected foreign selection; final current-user permission checks follow below. Query target direct event memberships in this exact org in one set query and lock those Event rows sorted.
2. Lock pending organization/event invitation rows addressed to target within org, in deterministic order; then actor and any successor User SHARE checks. This invitation-before-User order agrees with privacy withdrawal→deactivation, including self-leave. Re-resolve activity/authority/self standing. Missing target is 404 only after tenant authorization; an already-departed self request gets generic 403 through resolver, without pretending it is idempotent. Target User UPDATE is unnecessary for removal.
3. Before any deletion, require another active org OWNER when target is OWNER; group/count active direct event OWNERS in Postgres and reject if target has a direct OWNER role and no other active direct OWNER exists on that event. Return `OWNER_HANDOVER_REQUIRED` with bounded own-tenant affected event IDs only; no guests/names/financial data. Existing zero-direct-owner events are not newly orphaned by deleting a nonowner. Any failed check rolls back everything.
4. Delete **all** target event memberships in exact org, regardless of role or grant date; delete org membership; revoke live org/event invites addressed to target within org. Mark target-requested QUEUED/RUNNING seating/export jobs in target tenant access-revoked using current job/lease fences. Do not touch unrelated orgs, another user's jobs or completed evidence. Workers that won earlier committed before departure; later workers reread no customer authority and cannot apply/publish.
5. Increment accessRevision; record minimal durable role-change evidence without contact/guest copies; commit `{organizationId,removedUserId,revokedEventRoles:<count>,accessRevision}`. Invalidate tab selection locally. Unrelated memberships/event-only grants and sessions remain. Never alter platformRole or independent F39/F44 staff assignments: legitimate ADMIN/SUPPORT powers remain subject to their domain-specific assignments. PP-D49 revokes customer-derived standing, not staff employment authority.

Atomic operation rejects all changes on missing handover, stale revision, permission change or invite race. No interim membership deletion followed by async event role cleanup. Promoting successor and departure can be done sequentially through explicit requests because each removal independently checks invariants; no failure leaves ownerless state.

**ADMIN-reviewed closure/recovery.** `POST /organizations/current/closure-reviews` `{expectedRevision}` by current last OWNER writes one OPEN LAST_OWNER_CLOSURE review; it removes no membership, stops no payment and returns `{reviewId,status:"OPEN"}`. `GET /admin/organization-access-reviews?limit=50&cursor=...` and `POST /admin/organization-access-reviews/:reviewId/resolve` are ADMIN-only/platform-only. Resolution requires `{decision:"HANDOVER"|"CLOSE"|"DECLINE",expectedRevision,successorUserId?}`; no automatic closure on request. HANDOVER requires existing active successor and explicit event OWNER handovers where applicable. CLOSE soft-closes org (`deletedAt`), revokes **all** tenant memberships/event roles and pending invites/jobs under org UPDATE, sorted event fences and current ADMIN authority checks, preserving events, accepted/financial records, artifacts under existing retention and account links. It cannot transfer or erase accepted financial history or invent refund/cancellation effects; future corporate obligations and external retention gates are separately reviewed. If any existing dependent workflow cannot safely freeze it, resolution refuses unchanged for ADMIN remediation. F38 does not perform automatic subscription charges/cancellations. DEAD/inactive owner recovery permits ADMIN handover or reviewed closure, never creates new customer rights from an email alone.

Closure resolution locks org UPDATE, all affected Event rows sorted, required invitation rows, then current ADMIN User SHARE. It does not UPDATE-lock all removed users. All competing role writers take org fence first, so enumeration cannot miss a late grant. Remove every tenant role and pending invite atomically. HANDOVER validates active successor; reviewed CLOSE is the explicit alternative to last-owner protection. Refuse unchanged if measured workload cannot complete within transaction budget.

**Concierge 0/1/many**, existing `POST /concierge/organizations`: add optional `organizationId` to `OpenForCustomerDto`, 1–64; ownerEmail stays normalized/email-bound, not a new general email lookup API. Under current staff `concierge:manage` and transaction-aware `resolveCustomerOrganizations`:

* 0 live customer org memberships, no explicit target: create org + OWNER invite atomically; staff gains no membership. Do not add membership before acceptance.
* Exactly 1, no explicit target: reuse D8 organization and return `invite:null,isExisting:true` without creating anything. No new OWNER privilege is granted if the customer is currently a MEMBER.
* Several, no explicit target: `409 ORGANIZATION_SELECTION_REQUIRED` before writes. Staff retrieves choices through existing authorized staff search plus a bounded new `POST /concierge/organizations/resolve-customer` body `{ownerEmail,limit,cursor}` (staff-only max email 200, limit default/max 50, cursor 256); return `{items:[{id,name,kind,createdAt}],nextCursor}` only for that customer’s current org memberships, without owners’ emails, guests, financial data or raw request-body logging. F39 reuses internal resolver, not a customer-accessible email enumeration route.
* Explicit target: verify the named customer's **current** membership belongs to that open organization; otherwise same generic 403. Staff target authorization is still required; specifying email+id proves no authority. No create-extra-on-ambiguity flag: new customer extra organization creation is the customer's explicit create intent; D8 remains compatible.

For new staff-created orgs pending OWNER acceptance, pending valid owner invite is a provisional onboarding state, not an active-owner membership. Recover revoked/expired provisional invites through staff concierge; do not make them count as active owners for departure checks.

## 6. Privacy, workers and delayed effects

Verified privacy erasure is not ordinary self-leave: existing `closeAccount` deactivates/anonymizes an account while retaining its organizational/event links. F38 must not block a verified erasure because the person is last OWNER, fabricate a successor, or hard-delete tenants. Preserve inactive tombstone role/history relationships; inactive User always fails request/worker authorization across **every** organization/event. Increment sessionGeneration while revoking sessions; pending org/event invitations addressed to the old email are withdrawn as today. Before losing the address, collect only subject user ID and affected org/event IDs; create deduped ADMIN INACTIVE_OWNER_RECOVERY reviews for each org where no active owner remains. ADMIN chooses reviewed handover or soft closure; no ordinary member sees another org's review. Preserve PP-D58 distinctions and existing pilot data-retention policy.

Keep erasure's export privacy → orders/household/guest → withdrawInvites → closeAccount User update sequence. It does not mutate memberships and must not acquire org access fence after those locks. Current worker User SHARE means closure either waits for a worker commit or finishes first and the worker sees inactive. Accept takes invite row before User SHARE, matching withdrawal-before-deactivation. Do not add organization review FKs after User update: the initial ADMIN recovery queue can be a live authoritative query over inactive sole owners, with idempotent review creation in a separate transaction after erasure. A bounded reconciler rechecks org/current active owners under org fence before creating a review. If durable notification is later required, write an account-recovery intent with anonymized user/org IDs and no org FK, then reconcile after commit. Verified erasure never waits on SMTP/review creation. Aggregate all owned/member orgs, never first-row selection; preserve platform-wide addressed-invite withdrawal including event-only invitations. Increment sessionGeneration at closure; cancel/deny account-authorized jobs across all orgs while preserving accepted evidence links.

Seating capture and apply re-resolve actual event org, active user, exact org/event standing; no job-stored role/selected org. Apply holds org SHARE/event UPDATE/current User SHARE and exact role locks until commit, downstream of no storage/CPU. If exit wins first, `ACCESS_REVOKED` terminal failure with zero seat writes. If apply wins first, exit waits; event change precedes completed departure. Preserve lease ownership/fencing and attendance/arrangement revision tests.

Export capture and publish use privacy SHARE → org SHARE → current User SHARE/authorization → job/artifact updates. Remove/leave cannot commit while publish holds org SHARE; later publish fails current authority. Storage upload has no locks; artifact reservation ledger/cleanup handles uploaded-but-unpublished bytes. Download rechecks current event/contact access after storage I/O and revocation. The removal transaction revokes only customer-derived access; a current ADMIN or legitimately authorized SUPPORT worker may still act through independent platform standing. Test that distinction rather than assuming removal must make every staff account fail actorCan. No attempt to revoke raw already-downloaded copies or promise exactly-once external delivery. Other private-media/background paths must be classified by who authorizes them: guest capability jobs keep guest/invitation privacy checks; host-requested new workers must use this actor fence protocol before publication. Scheduled guest communications are event workflows, not grants stored on the former member; don't cancel legitimate tenant reminders because one operator left.

## 7. Red-first verification map and remaining acceptance

Avoid duplicating each rule at every layer. Pure branch/shape policy belongs in unit tests, real relational/concurrency invariants in integration, HTTP behavior in e2e. Existing tests asserting one-organization forever are replaced in activation commit; compatibility-flag tests retain the protected old behavior until then.

| Layer/file (new unless marked existing) | First failing cases and coverage |
|---|---|
| `backend/src/infra/auth/organization-context.spec.ts` | Pure full 0/1/2+ selector truth table, foreign/revoked/deleted masking, event-derived event-only context, staff explicit mode permissions, no header→role privilege borrowing, path/header mismatch, duplicate/header-bound validation. |
| `backend/src/common/localized-feedback.spec.ts` (existing) + `backend/src/common/filters/all-exceptions.filter.spec.ts` | Specific safe codes survive filter; malformed selector names organizationId; en/ru/fr/hy recovery action; no raw token/foreign name in errors. |
| `backend/test/integration/organization-lifecycle.int-spec.ts` | Two concurrent last-owner demotions/leaves retain one active owner; unique composite membership; failed event-owner handover rolls back org removal and every event role; successful departure deletes OWNER/COORDINATOR/DESIGNER/VIEWER rows across target org while unrelated org/event-only grants and independent platform powers survive; stale revision changes nothing; fresh invite after removal allowed. |
| `backend/test/integration/organization-invites.int-spec.ts` | Concurrent same-token accepts exactly one row and safe replay, rotated/revoked token fails after waiting, password-reset/deactivation invalidates preverified user, new-account registration collision cannot squat membership, role changed after invite is not overwritten, departure vs event acceptance cannot restore revoked access, unrelated-org joins serialized safely. |
| `backend/test/integration/organization-migration.int-spec.ts` | Disposable populated pre-F38 schema retains membership/event/invoice IDs, foreign keys, case-insensitive email and token uniqueness; additive migration no role/default guess; old gate rejects 2nd join before drop; post-drop schema permits 2nd org but duplicate pair fails; rollback precondition rejects multi-membership data without deleting it. |
| `backend/test/integration/organization-worker-revocation.int-spec.ts` | Deterministic barriers for queue→remove→apply, apply-lock→remove-waits, role downgrade and account closure; export upload→remove→publish refuses and artifact cleans up; membership loss during download IO denies bytes; no unrelated org job cancellation. Include concurrent team changes and org exit to prove lock order, no sleep-based races. |
| `backend/test/integration/privacy-erasure.int-spec.ts` (existing) | Subject with several orgs + event-only grant deactivates everywhere, all addressed invites withdrawn, reviews for inactive sole owners, tombstone accepted/financial history intact, worker fence blocks late apply; privacy/export lock contention terminates with allowed retry rather than deadlock. |
| `backend/test/integration/ticket-admission.int-spec.ts` and `attendance-transition-locks.int-spec.ts` (existing) | Ensure new authority helpers do not invert policy/order/guest/ticket order; run host admission concurrently with exit/privacy and preserve admission/cancellation safety. Do not duplicate existing capacity tests. |
| `backend/test/e2e/organization-context.e2e-spec.ts` | Existing one-org clients unchanged; own selector minimal bounded projection/no contacts; 2-org omission 409; create independent of ambiguous current selection; header/query/body cannot grant authority; event and slug links derive actual org; mismatch 409; no-org event-only list usable; staff no-header platform list stays paged. |
| `backend/test/e2e/organization-members.e2e-spec.ts` | Invite/accept/create/leave/remove/owner-transfer DTO bounds and status/body; customer cannot list another tenant; MEMBER self-leave allowed, cannot remove peer; OWNER transfer requires active accepted successor; last-owner error and ADMIN review routes cannot be invoked by SUPPORT/customer; role isolation. |
| `backend/test/e2e/access-rules.e2e-spec.ts` (existing) | Replace B14 forever-one-org cases with flag-off compatibility and flag-on idempotent creation; OWNER A/MANAGER B creates event in B as COORDINATOR; reverse as OWNER in A; supplied org query never scopes event list. |
| `backend/test/e2e/account.e2e-spec.ts`, `team.e2e-spec.ts`, `concierge.e2e-spec.ts` (existing) | Existing account proof preserved, repeated accepts don't restore stale role; exact 0/1/many concierge owner-email behavior and atomic no-orphan creation failure; staff no membership; team last-owner protection. |
| `backend/test/e2e/billing.e2e-spec.ts`, `vendors.e2e-spec.ts`, `privacy-and-exports.e2e-spec.ts` (existing) | Two-org invoice/promo/subscription/suppression/private-vendor isolation via IDs and selectors; SUPPORT never gains billing; curated staff behavior remains; membership removal closes artifact downloads. |
| `backend/scripts/pilot/organization-context.test.mjs` and edge tests | CORS preflight header/Idempotency-Key passes allowed origins; wrong origin rejected; schema compatibility gate prevents mixed-version activation. |

First red coding action: add `organization-context.spec.ts` with no-header 0/1/2, exact header lookup and event-derived role tests **while user uniqueness remains**. Confirm failure due missing resolver, then implement compatibility resolver/wire the guard. Do not start by deleting the index.

Targeted commands from repository root; local slice evidence is summarized above, and combined full verification is recorded by the integration owner:

```sh
cd backend
npm run test:unit -- --runTestsByPath src/infra/auth/organization-context.spec.ts
npm run test:int -- --runTestsByPath test/integration/organization-lifecycle.int-spec.ts test/integration/organization-invites.int-spec.ts test/integration/organization-worker-revocation.int-spec.ts test/integration/organization-migration.int-spec.ts
npm run test:e2e -- --runTestsByPath test/e2e/organization-context.e2e-spec.ts test/e2e/organization-members.e2e-spec.ts test/e2e/access-rules.e2e-spec.ts test/e2e/concierge.e2e-spec.ts
npm run openapi
npm run verify
```

Full verify is the actual package script: lint + docs check + OpenAPI check + build + pilot tests + all three test layers. If local stores are unavailable, start only authorized disposable/local test stores; no destructive reset or real shadow DB. Generate migration SQL with `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` only in the authorized implementation environment; never pass real DB as shadow URL. Tests use isolated test URLs/schema. Parent orchestration decides when coding/database execution is authorized.

## 8. Small commit sequence, operational proof and completion

1. **Compatibility resolver + client contract**: unit red/green, actor context and metadata, exact role lookup, bounded membership selector, localized errors/CORS, creatorRole fix, owner-email 0/1/many resolver. Keep uniqueness and new writes disabled. Docs/API/README/ACCESS_CONTROL + OpenAPI same commit. Exports to F39/F44 become usable now.
2. **Additive lifecycle schema + transactional invites/create**: revision/acceptedBy/intent/review schema, populated migrations; organization aggregate fences preserving event/User/role lock order; transactional Message enqueue; safe repeated accepts; existing flag-off tests pass. No second membership yet.
3. **Departure and recovery**: member/owner-transfer/leave/remove/review APIs, all target-org direct-role revocation, pending-token invalidation, team/concierge transaction fixes, lifecycle/HTTP tests. Document ADMIN review cannot erase history or infer financial settlement.
4. **Worker/privacy lock integration**: organization prefix before existing seating order, export authority fences, privacy-compatible invite ordering and inactive-owner review reconciliation, deterministic concurrency and host-admission regressions. Gate activation on complete writer inventory, not only resolver passing.
5. **Cutover migration + activation**: index drop, process/credential exclusion runbook, database write gate, replace B14 expectations, populated restore/performance rehearsal, four-language/tab acceptance. Separate schema application from write-gate enablement. Do not combine F37/F44 feature policies into this commit.

For each behavior commit update current governing docs and remove only actually built entries from “not yet built”; do not document proposed routes as live before implementation. Update `backend/docs/ARCHITECTURE.md`, `backend/docs/DATA_MODEL.md` and `DATA_STORES.md` when adding durable notice/review storage. `docs:check` and OpenAPI are required and do not prove tenant isolation by themselves.

Operational evidence before activation:

* Review signed-off process inventory: API, export/seating/private-media workers, maintenance schedulers, CLI scripts, seeds, migrations and admin repair tools; all organization readers are scope-aware and membership writers follow fences. Record image/build revision and PostgreSQL sessions before unique-index drop. Maintenance/session/credential procedures here are future operator-controlled deployment steps, not authorization from this planning task to stop unrelated checkouts, processes or real sessions. Old runtime exclusion is a hard gate.
* On populated disposable DB, compare organization/member/event/invoice counts and IDs before/after. Query duplicate `(userId,organizationId)` and active last-owner risk; flag legacy provisional or inactive-owner organizations for recovery, never mutate them to satisfy a test. Confirm existing lower-email/token constraints survive.
* `EXPLAIN (ANALYZE, BUFFERS)` for 0/1/many resolution, membership cursor, exact event tenant role, selected event list, target event-role deletion, owner count and invite revocation. Seed an agency with many events/direct roles and a user spanning orgs; assert bounded response and set-based DB queries. Measure P95 against product latency targets; if synchronous revoke cannot fit, choose measured operational bound and documented unchanged refusal before enabling that workload. No N+1 owner loop.
* Use existing `npm run test:backup` and disposable `npm run backup:rehearsal` workflow, extended with two-org user, cross-org event-only grant, accepted invite/intent/review rows and memberships removed in one org. Restore Postgres + required private artifact/storage metadata; after restore verify target-org revocation, unrelated grants, last-owner state, no permission from old JWT membership claims, and worker lease recovery. Save evidence in ignored test-results, no tokens/customer PII in repository. A local rehearsal does not prove off-host backups or production RPO/RTO. Run the destructive restore/rehearsal only against newly created disposable resources, never a real checkout database or production session.
* Recovery rehearsals: lost browser selection, invite resend, same-key retry after lost response, worker lease expiry during exit, all owner accounts inactive, failed cutover before first second membership, write-disable after multiple memberships, and rollback refusal without deleting grants. ADMIN reviewed recovery uses authoritative rows/audit IDs; never restore access by copying a different tenant's role.

Completion means explicit per-tab selection works with legacy one-org clients; additional create/invite joins are safe; every known first-membership assumption is removed; last organization/direct-event OWNER protections hold under concurrency; exit atomically revokes every direct role and pending invite in the target org; worker commits and downloads cannot preserve revoked rights; unrelated org/event-only access remains; schema/restore/cutover proofs are recorded; full verify and frontend four-language/tab acceptance pass. This plan by itself closes none of those implementation gates.
