# Aveline

Custom event invitations, organization and management.

> The invitation is the front door. Everything behind it — the guest graph,
> the headcount, the seating, the vendor briefs — is the product.

## Repository

| Path | What |
|---|---|
| [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) | Product definition: positioning, architecture, feature set, services, packaging |
| [`backend/`](backend/) | TypeScript · NestJS · PostgreSQL · Prisma |

## Getting started

```bash
cd backend
cp .env.example .env
npm install
npm run db:up && npx prisma migrate dev && npm run db:seed
npm run start:dev
```

See [`backend/README.md`](backend/README.md) for endpoints and design notes.
