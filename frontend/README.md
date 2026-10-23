# Aveline frontend

The web client for Aveline: the guest invitation first, then the organizer app, whose way in
(sign-in and onboarding) exists. React Router 8
with server rendering, on Vite. How it is built: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
How we work: [docs/WORKFLOW.md](docs/WORKFLOW.md). Agent rules: [CLAUDE.md](CLAUDE.md). The
design: [docs/design/](docs/design/README.md).

## Prerequisites

- **Node 24.** The default shell Node on some machines is older; run `nvm use` in this folder
  (`.nvmrc`). Installing with the wrong Node fails at once (`engine-strict`).
- **The backend running locally**, for the guest page and the end-to-end tests. Its databases
  run in Docker, so Docker must be installed:

  ```bash
  cd ../backend
  npm run db:up          # Postgres, Redis, Mongo, Garage
  npm run db:seed        # one demo wedding; prints guest links
  npm run start:dev      # API on http://localhost:3000
  ```

## Run it

```bash
nvm use
cp .env.example .env     # the defaults work against the local backend
npm install
npm run dev              # http://localhost:5173
```

Open a guest link printed by `db:seed`, without its `/api` prefix:
`http://localhost:5173/invitations/anna-davit/g/<token>`. The generic page is
`http://localhost:5173/invitations/anna-davit`.

The organizer app starts at `http://localhost:5173/sign-in`. The seeded accounts have no password
(FR-14), so create one at `/register`; the emails it sends land in the backend's dev inbox,
`http://localhost:8025`.

## Scripts

| Script | Does |
|---|---|
| `dev` | The development server on port 5173, with `/api` and `/files` (uploads on the backend's disk) proxied to the backend |
| `build`, `start` | A production build, and `react-router-serve` for local use |
| `typecheck`, `lint`, `lint:fix`, `format`, `format:check` | Types, ESLint (zero warnings), Prettier |
| `test`, `test:e2e` | Vitest; Playwright against the running backend (no end-to-end tests are written yet) |
| `api:generate` | `src/api/schema.ts` from `../backend/openapi.json` |
| `tokens`, `tokens:check` | `src/styles/tokens.css` and `theme.css` from `src/styles/tokens.json`, and a drift check |
| `check:boundaries` | Lists changed paths outside `frontend/`; must be empty |
| `verify` | `api:generate`, `tokens:check`, `format:check`, `typecheck`, `lint`, `test`, `build` |
