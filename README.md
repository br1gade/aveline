# Aveline

Custom event invitations, organization and management.

> The invitation is the front door. Everything behind it — the guest graph,
> the headcount, the seating, the vendor briefs — is the product.

---

## For the client team, start here

| | |
|---|---|
| [`docs/API.md`](docs/API.md) | How to call the backend. Conventions first, then every endpoint |
| [`backend/openapi.json`](backend/openapi.json) | Generated schema — feed it to a type generator |
| [`docs/CLIENT_CLAUDE.template.md`](docs/CLIENT_CLAUDE.template.md) | Drop-in rules file for the client project |

```bash
cd backend && npm run openapi
npx openapi-typescript backend/openapi.json -o src/api/schema.ts
```

## Shared — the product and the contract

| Doc | Covers |
|---|---|
| [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) | What Aveline is, how it works, how it makes money |
| [`docs/API.md`](docs/API.md) | The HTTP contract |
| [`docs/ACCESS_CONTROL.md`](docs/ACCESS_CONTROL.md) | Accounts, roles, permissions, capability links |
| [`docs/INVITATION_DESIGN.md`](docs/INVITATION_DESIGN.md) | Templates, blocks, media, RSVP questions |
| [`docs/VENUES_AND_SEATING.md`](docs/VENUES_AND_SEATING.md) | Venues, tables, seats, seating constraints |
| [`docs/PAYMENTS.md`](docs/PAYMENTS.md) | Armenian card acquiring and the redirect flow |

## Backend

| Doc | Covers |
|---|---|
| [`backend/README.md`](backend/README.md) | Running it, endpoints, layout |
| [`backend/CLAUDE.md`](backend/CLAUDE.md) | Engineering rules — binding in `backend/` |
| [`backend/docs/ARCHITECTURE.md`](backend/docs/ARCHITECTURE.md) | Request lifecycle, auth, jobs, degradation |
| [`backend/docs/DATA_MODEL.md`](backend/docs/DATA_MODEL.md) | Every model and the invariants the database enforces |
| [`backend/docs/DATA_STORES.md`](backend/docs/DATA_STORES.md) | Postgres, Redis, MongoDB — what goes where |
| [`backend/docs/STORAGE.md`](backend/docs/STORAGE.md) | Garage object storage |
| [`backend/docs/GAPS.md`](backend/docs/GAPS.md) | What is still unbuilt, prioritised |

```bash
cd backend
cp .env.example .env
cp garage/garage.toml.example garage/garage.toml   # fill in two secrets
npm install
npm run db:up && npx prisma migrate deploy && npm run db:seed
npm run start:dev
```

API on `http://localhost:3000/api/v1`, schema at `/docs`.

## Working here

[`CLAUDE.md`](CLAUDE.md) is what both teams share. Each area has its own rules
file that takes precedence inside it — Claude Code loads the nearest one
automatically.

The split that matters: **`docs/` is a contract between two teams**,
`backend/docs/` is one team's internal reasoning. Changing something in
`docs/` affects someone who is not in the room.
