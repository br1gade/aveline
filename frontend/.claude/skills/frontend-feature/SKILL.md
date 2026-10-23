---
name: frontend-feature
description: Build or change an Aveline frontend feature end to end: locate the contract, check backend requests and design defaults, plan, test first where there is logic, implement, verify, document and check the boundary. Use for any change under frontend/src. The root `feature` skill is backend-only.
---

# frontend-feature

The order in which `frontend/CLAUDE.md` applies. Follow every step for a standard change; for a
typo or copy fix, read, change and review the diff.

1. **Locate the truth.**
   - The API: `../docs/API.md` §1, §8 and the feature's section; run `npm run api:generate`.
   - The design: `docs/design/README.md`, then the governing spec section
     (`GUEST_INVITATION.md` or `DESIGN_SYSTEM.md`) and the provisional defaults in
     `DESIGN_DECISIONS.md` §6. Confirmed items (C-) bind; PDs are what you build on, never decisions.
2. **Check the backend requests.** `docs/BACKEND_REQUESTS.md` and the BACKLOG items it names. A gap
   you hit becomes a new entry, never a silent workaround.
3. **Plan.** What changes; routes and files; endpoints; every UI state (loading, empty, error,
   403, 409, 429); i18n keys in all three languages; tests; docs; risks; backend gaps. The user
   approves before any edit.
4. **Write the failing test** where there is logic: money, time, error mapping, session, payload
   building, block order.
5. **Implement** the smallest coherent change, in the feature's folder, through its `index.ts`.
6. **Run `npm run verify`.** Zero lint warnings. Run `npm run test:e2e` for touched journeys
   against the local backend.
7. **Update the docs** in the same change: `docs/ARCHITECTURE.md` ("Not yet built", the decision
   log), the design docs if behaviour or a PD changed, `docs/BACKEND_REQUESTS.md`.
8. **Review the diff** line by line against the plan. Remove or explain anything unplanned.
9. **Check the boundary.** `npm run check:boundaries` lists nothing outside `frontend/`.

Never commit, push or add a dependency unless the user asks.
