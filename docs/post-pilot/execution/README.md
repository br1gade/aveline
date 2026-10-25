# First implementation wave — execution coordination

Prepared 25 October 2026 against `bb01a61` on `codex/post-pilot-backend`.
Three parallel agents translate the approved [PP-D01–58](../DECISIONS.md) into
file-level implementation batches. These are plans; no proposed route, schema,
permission or migration in this directory has been implemented or applied.

| Workstream | Execution plan | First production-oriented deliverable |
|---|---|---|
| F39 enquiry/consultation intake | [Intake](INTAKE.md) | Staff-only cases with assigned access, revision-safe writes, privacy and approved retention |
| F38 multiple organizations | [Organizations](ORGANIZATIONS.md) | Exact organization-context compatibility before allowing a second membership |
| F44 template authoring | [Templates](TEMPLATES.md) | Exact legacy baseline version pinning, then private drafts/validation/preview |

Other F31–F44 features retain their [broader plans](../../POST_PILOT_IMPLEMENTATION_PLAN.md).
This wave deliberately picks independent nonfinancial slices. It does not move
tax rules, provider certification or protected-evidence retention out of their
external-input gates. Quotes/deposits, corporate, vendor revenue and physical
fulfilment are later consumers of these stable contracts, not implicitly built
by completing this wave.

## Common interfaces and code ownership

- Organization resolution belongs to F38. Keep the current RequestActor shape
  compatible and resolve exact membership/resource standing per request; new
  modules consume resolved identity/context, not JWT roles or arbitrary first
  membership. Concrete header transport is engineering/frontend coordination;
  approved per-tab UX is not an open product question.
- Intake is a platform staff/case scope. A selected organization or customer
  OWNER role does not grant enquiry access. Template authoring likewise requires
  explicit platform/assignment grants. New staff-only permissions must be added
  to PLATFORM_ONLY; otherwise current CUSTOMER_OWNED derivation grants them to
  organization owners automatically.
- Resource paths use named parameters such as enquiryId/templateId. AuthGuard
  currently falls back to params.id as an event ID even without EventScope;
  do not accidentally run new non-event resources through that inference.
- F39 owns the minimal transaction-aware concierge/event conversion seam; event
  creation keeps centralized defaults and template validation. F44 adapts that
  same creation/selection boundary to pinned, tenant-visible versions later.
  Neither agent should clone EventsService or create competing event builders.
- F38 owns membership/selection refactors. F44 owns template catalogue/version
  selection and invitation serialization changes. Their reviewers reconcile
  EventsService, AuthGuard, access-policy, Prisma and API/OpenAPI edits together.
- F38's narrow access fence is organization SHARE before existing event locks
  for role writers and actor-authorized worker apply/publish; leave/remove takes
  organization UPDATE first. Keep existing export privacy fences first and the
  downstream domain lock order. Do not introduce User-to-organization inversions
  in conversion or template paths. With F44, template selection SHARE sits
  after organization and before event/invitation/current User; author publication
  never locks consuming events or enquiries. The detailed plans must share this protocol.
- Credential-bearing owner invitations use the existing protected Message
  outbox through one transaction-aware enqueue helper. Invitation hash and
  queued Message commit together; audit and recovery rows contain IDs/state.
- All new domain errors preserve the existing localized HTTP feedback envelope.
  F38 owns the shared typed safe-code extension, consumed by F39/F44; no lane
  introduces a competing global error shape or trusts arbitrary exception codes.
- Each domain rechecks its current assignment/revision for writes. Worker apply/
  publish and private downloads also recheck live authority. Preserve existing
  next-request semantics for unrelated synchronous requests; do not invent a
  repository-wide locking rewrite merely to fit a preferred local hierarchy.

## Integration order and gates

1. Commit additive shared contracts/permission tests and compatible readers.
   Keep organization user uniqueness and all paid guards intact. Intake and
   template work remain runnable against existing single-membership tenants.
2. Merge independent new intake and template-version tables in a reviewed
   migration order. Add nullable fields, verify populated backfills, then
   constrain only where evidence exists. The Event `(id,organizationId)` unique
   key needed by F39 and F44 is one shared prerequisite migration/index, not two
   competing definitions. Never rewrite applied migrations.
3. Integrate transaction-aware creation/selection once. Ensure F39 conversion
   remains atomic/idempotent when F44 adds version pins and F38 allows explicit
   organization choice. Test all combinations of old/new feature flags.
4. Gate second memberships on the complete single-membership assumption and
   revocation/ownership inventory, compatible API/workers and opposing-race
   tests. Dropping a unique index is the final cutover, not the first step.
5. Gate newly authored publication on verified renderer capability evidence
   and four-language frontend acceptance. Legacy baseline pinning must preserve
   exact existing payloads; it must not rewrite templates to conceal renderer
   mismatches. Approved versions cannot auto-upgrade published invitations.
6. Verify privacy export/erasure for email and manually verified phone-only
   prospects, latest-close retention and restore replay before enabling intake
   contacts. Erasure markers apply to the affected case/contact and converted
   tenant, without creating a permanent cross-tenant recontact ban.
7. Run full backend verification after each integrated behavior slice, with
   integration and HTTP suites serialized against guarded aveline_test. If teams
   need concurrent DB suites, separately provision guarded test stores first.
   Measured load runs separately from build/tests.

Use separate implementation branches/worktrees per accepted batch and one
integration owner for shared schema, permission and migration changes. Suggested
future branches: codex/post-pilot-intake, codex/post-pilot-organizations and
codex/post-pilot-templates; this planning task does not create those branches.

## Evidence found during review

The locally available frontend snapshot `origin/frontend/guest-invitation`
(`1232107cc75249047105c14cbf8e11139390fff8`) contains an invitation renderer;
this is not a claim about the remote team's latest work. Its variant vocabulary
and theme handling differ from backend seed metadata, and its language list
omits French. F44 therefore preserves exact legacy payloads while newly authored
publication waits for a verified capability manifest, theme/preview parity and
four-language acceptance. These mismatches are concrete implementation gates,
not reasons to repeat the approved product-policy interview.

First red tests are explicit: F39 platform-only permissions and assignment
revocation; F38 0/1/many organization selection while uniqueness remains; F44
serialized legacy invitation compatibility before version pinning. See each
blueprint for file paths, opposing race cases and the small commit sequence.

## Scope and evidence limits

No live charges, sends, account purchases, transfers or external deployment.
Native F22 and entitlement enforcement remain deferred. Existing pilot frontend,
provider, host/TLS, backup, alerts and human-language acceptance gates remain.
Planning validation checks docs/relative links/whitespace and repository-required
lint before committing documentation; proposed functional test cases are not
reported as executed tests.
