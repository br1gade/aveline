# Aveline

Custom event invitations, organization and management.

> The invitation is the front door. Everything behind it — the guest graph,
> the headcount, the seating, the vendor briefs — is the product.

## Repository

| Path | What |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Engineering rules — binding for humans and agents |
| [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) | Product definition: positioning, architecture, feature set, services, packaging |
| [`docs/ACCESS_CONTROL.md`](docs/ACCESS_CONTROL.md) | Account types, roles, permissions |
| [`docs/VENUES_AND_SEATING.md`](docs/VENUES_AND_SEATING.md) | Venues, tables, seats and seating constraints |
| [`docs/INVITATION_DESIGN.md`](docs/INVITATION_DESIGN.md) | Templates, blocks, media, input requests, signatures |
| [`docs/DATA_STORES.md`](docs/DATA_STORES.md) | Postgres, Redis and MongoDB — what goes where and why |
| [`backend/`](backend/) | TypeScript · NestJS · PostgreSQL · Prisma · Redis · MongoDB |
| [`.claude/`](.claude/) | Hooks and the `/feature` workflow skill |

## Getting started

```bash
cd backend
cp .env.example .env
npm install
npm run db:up && npx prisma migrate dev && npm run db:seed
npm run start:dev
```

See [`backend/README.md`](backend/README.md) for endpoints and design notes.
