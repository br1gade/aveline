# Organization context cutover

Revision 2 compatibility is implemented; additional memberships default off.
The automatic migration retains `organization_memberships_userId_key`. This is
an operator-controlled activation step, not a deployment side effect.

1. Complete the reader/writer inventory in the F38 execution plan, opposing race
   tests, populated migration/restore rehearsal and four-language multi-tab client
   acceptance. Record reviewed evidence; do not substitute a green unit suite.
2. Stop API, job/scheduler and maintenance traffic; exclude old binaries, database
   credentials and existing old deployment sessions. Record process/image inventory.
   Never terminate unrelated local or production sessions through an agent task.
3. Supply a local JSON evidence file with revision 2 and true values for
   readerWriterInventory, raceTests, populatedMigration, restoreRehearsal,
   fourLanguageTabAcceptance, oldRuntimeExclusion. This file is operator evidence,
   not a source-controlled automatic assertion that the gates were completed.
4. Inspect with `node scripts/organization-cutover.mjs inspect`. With writes false,
   run `drop-single-membership-index` with ORGANIZATION_CUTOVER_MAINTENANCE=confirmed
   and ORGANIZATION_CUTOVER_EVIDENCE_FILE pointing to that reviewed file.
5. Start only revision-2 processes; smoke/regression checks precede the separate
   `enable-writes` action. Every create/join locks and reads the shared gate.
   Remove the user-only @unique annotation in the deployment schema when adopting
   the cutover; retain the composite user/organization uniqueness and lower-email
   index. Runtime lookup never uses the legacy user-only membership key.

`disable-writes` stops additional creates/joins while existing multiple memberships
remain readable. Emergency disabling needs no activation evidence file; a privileged operator can
stop new joins immediately. The command uses DATABASE_URL explicitly.
No command was run against a production or developer database in this change.

Before any second membership, rollback may recreate the single-user index only
when GROUP BY userId HAVING count(*)>1 is empty. Afterwards never delete grants to
recreate uniqueness or run old readers: disable writes and roll forward. Keep
financial/event/history records and existing staff powers intact.

Outstanding acceptance: full reader/writer operational inventory, frontend tab and
language acceptance, measured P95 and off-host restore evidence. Local integration
fixtures exercise controlled index drop and recreate it after truncating only the
isolated test database; this does not authorize a real cutover.

Authority fence detail: lifecycle and recovery acquire Organization FOR NO KEY
UPDATE, not FOR UPDATE. IDs never change. SHARE role/worker fences still serialize
against departure, but erasure may insert its organization suppression FK (KEY
SHARE) while holding an invitation lock. Blocking that FK with FOR UPDATE would
create an org→invite / invite→org cycle. Do not strengthen this lock without
reviewing every implicit foreign-key lock. Event/domain fences retain their own
existing strengths and order.

For authorized incident review, inspect organization_access_changes ordered by
organizationId/accessRevision; the matching index serves that exact query. These
rows contain only IDs/roles/state and are not a customer-contact export.
