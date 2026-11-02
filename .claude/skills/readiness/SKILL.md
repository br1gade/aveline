---
name: readiness
description: Assess what is left before Aveline can go live — backend code, client code, hosting and configuration, external accounts, decisions — with evidence from code and docs. Use when asked "is it done", "what's left", "are we ready to deploy", or for an end-to-end status.
---

# Readiness assessment

## 1. Delegate the sweep

Launch the `readiness-auditor` agent. It reads `docs/GOING_LIVE.md`,
`docs/TODO.md`, `docs/BACKLOG.md`, `backend/docs/GAPS.md` and every
`origin/frontend/*` branch, and checks claims against code. While it runs,
run the gate yourself:

```bash
cd backend && npm ci && npx prisma generate
npm run lint && npm run docs:check && npm run openapi:check && npm run build && npm run test:unit
```

Integration and e2e need Docker (`npm run db:up`); if it is absent, say they
were not run.

## 2. Check its claims

Spot-check at least three of its "open" items and every item it says no doc
lists. Drop what does not hold.

## 3. Record what is new

An item missing from `docs/GOING_LIVE.md` goes there (root `CLAUDE.md`: "add
to it when you find something"). It is a shared doc — say so in the commit.

## 4. Answer

First line: a direct verdict on whether only hosting and configuration
remain. Then the five buckets, shortest first, each item with its evidence.
End with the gate result.
