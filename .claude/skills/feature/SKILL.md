---
name: feature
description: Build or change an Aveline backend feature end to end, following the project's TDD cycle, complexity limits, performance rules and docs-sync requirement. Use when adding an endpoint, a service, a derived view, a schema change, or when fixing a bug in backend/. Also use when asked to "add", "implement", "build" or "fix" anything under backend/.
---

# Aveline feature workflow

The rules live in `backend/CLAUDE.md`. This skill is the order to apply them in.
Do not skip steps because a change "looks small" — the docs step is the one
most often skipped and the one that rots the codebase fastest.

## 1. Locate the truth before writing anything

Read the doc that governs the area you are about to change:

| Area | Doc |
|---|---|
| Positioning, pricing, packaging, domain model | `docs/PRODUCT_SPEC.md` |
| Roles, permissions, who-can-do-what | `docs/ACCESS_CONTROL.md` |
| Venues, tables, seats, seating rules | `docs/VENUES_AND_SEATING.md` |
| Templates, blocks, media, RSVP questions | `docs/INVITATION_DESIGN.md` |
| Caching, queues, analytics, store choice | `../../../backend/docs/DATA_STORES.md` |
| Payments, refunds, providers, money handling | `docs/PAYMENTS.md` |
| Endpoints, setup | `backend/README.md` |
| **Anything a client can see** | **`docs/API.md` — a contract, not a description** |

If the doc and the code disagree, **stop and say so**. Do not silently pick one.

Check that doc's "Not yet built" section — the thing you are about to add may
already be listed there, which tells you the intended shape.

## 2. Write the failing test first

Pick the layer by what is actually under test:

- **Unit** (`src/**/*.spec.ts`) — pure logic, derivations, policy. No database.
  Mock Prisma. This is where branch coverage belongs.
- **Integration** (`test/integration/**/*.int-spec.ts`) — a service against real
  Postgres. Transaction boundaries, relational writes, constraint behaviour.
- **E2E** (`test/e2e/**/*.e2e-spec.ts`) — HTTP. Status codes, validation,
  response shape.

Do not test the same rule at two layers. Pick the cheapest one that can fail
for the real reason.

Design the test's **domain set** deliberately:

- Test the boundary, not one happy value. Capacity 2 means testing 1 and 2.
- Use `it.each` when the rule has a range.
- Assert the **output range**: a rejected payload is a 400 naming the field,
  never a 500, never a silent coercion.
- Name the test for the behaviour: *"rolls the whole submission back when
  capacity is exceeded"*, not *"tests submit"*.

Run it. **Confirm it fails for the right reason** before implementing.

## 3. Implement the smallest thing that passes

Limits are enforced by lint and are not negotiable: 60 lines per function,
depth 3, complexity 10, 4 parameters. When you hit one, extract — never raise
the limit, never add `eslint-disable`.

Prefer a lookup table to a branch. `src/modules/access/access-policy.ts` is the
reference: adding a role is adding a row.

## 4. Check the performance rules before you move on

Aveline is IO-bound. Re-read what you wrote and confirm:

- No `await` on a query inside a loop over unbounded data (N+1).
- Aggregation happens in Postgres (`groupBy`, `count`), not by pulling rows.
- `select` / `include` fetch only what is used.
- Every multi-write path is inside `$transaction`.
- A read-then-write check is not racy under concurrent requests. Capacity and
  uniqueness belong in constraints, not only in an earlier `SELECT`.
- Nothing CPU-heavy runs inline in a request. Seating, exports and image work
  belong in a job.
- Any new filter or sort column has an index.
- A screen needs one request, not five. An intent is one atomic call.
- Anything cached is invalidated by every write that changes it.
- Redis or Mongo being down degrades the request, never fails it.
- Money is integer minor units; AMD has no subunit.
- Anything chargeable is idempotent by a database constraint, not a check.

## 5. Schema changes

- Add nullable → backfill → constrain. Never add `NOT NULL` to a populated
  table in one step.
- Generate SQL with `prisma migrate diff`, then edit it to be backfill-safe.
  `migrate dev` needs a TTY and will not run here.
- Never edit an applied migration. Write a new one.
- `migrate reset` destroys data and needs explicit human consent. Do not run it
  on anything you did not create moments ago.

## 6. Update the docs in the same change

Not the next commit. This one.

- Update the governing doc from step 1 to match the new behaviour.
- Update its **"Not yet built"** list — remove what you just built, add what you
  discovered is missing.
- If you added or changed an endpoint, update `backend/README.md` **and**
  `docs/API.md`. The second is what the client team builds against: adding a
  field is safe, renaming or removing one is breaking, and the commit message
  should say which.
- If business rules changed, update `docs/PRODUCT_SPEC.md`.

A doc describing code that no longer exists is worse than no doc, because it is
believed.

`npm run docs:check` catches broken links, undocumented endpoints and missing
permissions. It cannot catch a "not yet built" list that has become false —
re-read that section and delete what you just built.

## 7. Verify

```bash
cd backend && npm run verify
```

That runs lint (zero warnings), build, then unit → integration → e2e.
All of it must pass. If integration or e2e cannot reach Postgres, start it:

```bash
npm run db:up
```

## 8. Before you call it done

- [ ] Test written first, failed for the right reason, now passes
- [ ] All three layers green, lint clean, build clean
- [ ] Docs updated in this change, "Not yet built" still accurate
- [ ] No N+1, no blocking call, no untransacted multi-write, no race
- [ ] Names say what things are; comments say why, not what
