# Aveline — Engineering Rules

Binding for everyone, human and agent. If a rule here conflicts with habit,
the rule wins. If a rule is wrong, change it here first.

---

## 1. The one rule that explains the others

**Write code the next reader can hold in their head.**

The next reader is a teammate at 2am or an AI agent with no memory of this
conversation. Both need the same thing: small units, honest names, no cleverness
that has to be decoded. Optimize for being understood, not for being short.

---

## 2. Simplicity

- **A function does one thing.** Max 60 lines, enforced by lint.
- **Max nesting depth 3**, max cyclomatic complexity 10, max 4 parameters.
  All enforced. When you hit a limit, extract — do not raise the limit.
- **Prefer a lookup table to a branch.** `access-policy.ts` is the model:
  adding a role is adding a row, never adding control flow.
- **No premature abstraction.** Two similar things are two things. Extract on
  the third.
- **No dead code, no commented-out code, no `TODO` without an issue.**
- **Delete before you add.** The best change removes more than it introduces.

## 3. Naming

Names are the primary documentation. Get them right and most comments vanish.

- **Say what it is, not how it works.** `cateringSheet`, not `getGuestsWithDiet`.
- **Booleans read as assertions**: `isPublished`, `hasSeats`, `canEdit`.
  Enforced by lint.
- **Functions that do something start with a verb**; functions that answer a
  question read as the question.
- **No abbreviations** except the ones the domain already uses (`rsvp`, `id`).
  Not `evt`, `inv`, `hh`.
- **Match the ubiquitous language.** The code says `Household`, `Attribution`,
  `Covers` because the business says them. If the business renames something,
  rename it here and in the docs in the same commit.

## 4. Comments

Comment **why**, never **what**. The code already says what.

A comment earns its place when it records a decision, a trade-off, or a
non-obvious constraint — the thing a reader would otherwise have to reconstruct
or get wrong. Reference the spec section when the reason lives there.

```ts
// Named plus-ones become real Guest rows rather than free text, because
// seating and check-in both operate on people, not counts (spec §4).
```

## 5. Correctness under load

Aveline is IO-bound almost everywhere: the work is Postgres round-trips, not
computation. Design accordingly.

- **Never block the event loop.** No synchronous file, crypto or network calls
  in a request path. CPU-heavy work (seating, exports, image processing) goes
  to a job, never inline.
- **No N+1 queries.** Fetch with `include` / `select`, or aggregate in the
  database. If a loop contains an `await` on a query, that is a bug unless the
  iteration count is provably small and bounded.
- **Aggregate in Postgres, not in Node.** `groupBy` and `count` beat pulling
  rows to count them. The bar sheet does this; follow it.
- **`select` only what you need.** Especially on guest queries, which scale to
  hundreds of rows per event.
- **Every multi-write operation is a transaction.** If a submission half-applies
  on failure, that is a defect. The RSVP service is the reference.
- **Guard against concurrent writes.** Capacity checks that read-then-write are
  racy under concurrent RSVPs; enforce with a unique constraint or a
  conditional update, not with an earlier `SELECT` alone.
- **Index what you filter and sort on.** Every `@@index` must correspond to a
  real query.
- **Bound everything that comes from outside.** Array sizes, string lengths,
  page sizes. Enforced in DTOs.

## 6. API shape follows the UX promise

`docs/PRODUCT_SPEC.md` §12 commits to operations that are fast and easily
arranged. Most of that is decided here, not in the frontend.

- **A screen is one request.** If a view needs five numbers, build one endpoint
  that returns five numbers. `GET /events/:id/dashboard` is the reference.
  Independent queries inside it run with `Promise.all` — the cost is the
  slowest, not the sum.
- **A user intent is one request, atomically.** Rearranging blocks is one
  `PATCH`, not one call per block. A partial failure must not be able to leave
  the page half-changed.
- **Validate before you write.** A rejected request changes nothing, and the
  error names the offending field or item.
- **Omitted means "leave as is".** Never force a client to restate unchanged
  fields to change one.
- **Order is data.** Take the array order; never make the client compute
  indices.

Hit the latency targets in §12. If a surface cannot, it belongs in a job.

## 7. Choosing a store

Three stores, one job each. Full rationale in `docs/DATA_STORES.md`.

- **PostgreSQL holds the entire domain.** Nothing that must be correct lives
  anywhere else. Variably shaped data that belongs to an aggregate stays here
  as a `Json` column — splitting an aggregate across stores buys nothing and
  costs consistency.
- **Redis holds only what can be rebuilt.** Cache, rate limits, job queue. A
  cache outage must never become a product outage: every path degrades to
  "not cached" and proceeds against Postgres. Invalidate with `SCAN`, never
  `KEYS`.
- **MongoDB holds append-only observability.** All four must hold: append-only,
  never joined, variably shaped, and losing it costs insight rather than
  correctness. Writes are fire-and-forget; aggregate in Mongo, never in Node.

When unsure, it is Postgres.

## 8. Testing — TDD

**Write the failing test first.** Red, green, refactor. A bug fix starts with a
test that reproduces it.

Three layers, each with a distinct job. Do not duplicate across them.

| Layer | Location | Subject | Database |
|---|---|---|---|
| **Unit** | `src/**/*.spec.ts` | Pure logic, derivations, policy | None — mocked |
| **Integration** | `test/integration/**/*.int-spec.ts` | Services against real Prisma: transactions, relational writes | Real |
| **E2E** | `test/e2e/**/*.e2e-spec.ts` | HTTP: status codes, validation, response shape | Real |

```bash
npm run test:unit    npm run test:int    npm run test:e2e
npm run verify       # lint + build + all three layers
```

### What a good test asserts

- **Domain sets, not one happy value.** Test the boundary: if capacity is 2,
  test 1 (fits) and 2 (does not). Use `it.each` for the range.
- **Output ranges.** A rejected payload must be a 400 naming the field — never
  a 500, never a silent coercion. Assert the shape, not just the status.
- **Real relationships.** Integration tests use real foreign keys. If a mock
  would pass but Postgres would not, the test is worthless.
- **The name states the behaviour**, not the method: "rolls the whole
  submission back when capacity is exceeded".

### What not to test

Framework behaviour, Prisma's own correctness, or getters. Test *our* rules.

## 9. Linting

`npm run lint` must pass with **zero warnings** before any commit.
Never add `eslint-disable` without a comment on the same line explaining why,
and never to silence a complexity rule — extract instead.

## 10. Docs and code stay in sync

**This is not optional and it is the rule most easily skipped.**

When behaviour changes, the doc changes **in the same commit**:

| Change | Also update |
|---|---|
| Business model, pricing, packaging, positioning | `docs/PRODUCT_SPEC.md` |
| Caching, queues, analytics, a new store | `docs/DATA_STORES.md` |
| Roles, permissions, who-can-do-what | `docs/ACCESS_CONTROL.md` |
| Venues, tables, seats, seating rules | `docs/VENUES_AND_SEATING.md` |
| Templates, blocks, media, questions | `docs/INVITATION_DESIGN.md` |
| Endpoints, setup, project layout | `backend/README.md` |
| Schema | the doc that describes that part of the domain |

A doc that describes code that no longer exists is worse than no doc, because
it is believed. If you cannot update the doc, you do not understand the change
well enough to ship it.

**Every doc states what is not yet built.** Keep those sections honest — they
are the first thing a new reader checks.

## 11. Migrations

- **Every migration must be safe against a populated database.** Adding a
  `NOT NULL` column means: add nullable, backfill, then constrain. See
  `20261004120000_access_control_venues_design` for the pattern.
- **Never edit an applied migration.** Write a new one.
- **Destructive operations need explicit human consent.** Never run
  `migrate reset` against anything you did not create seconds ago.

## 12. Definition of done

- [ ] Failing test written first, now passing
- [ ] All three test layers pass
- [ ] `npm run lint` clean, zero warnings
- [ ] `npm run build` clean
- [ ] Docs updated in the same commit
- [ ] "Not yet built" sections still accurate
- [ ] No N+1, no blocking call, no untransacted multi-write
