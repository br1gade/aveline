# Aveline

Custom event invitations, organization and management.

Two teams work in this repository: **backend** and **client**. This file is
what both share. Each area has its own rules file, which takes precedence
inside that area.

---

## 1. Where things live

```
docs/            SHARED — the product and the contract. Both teams.
  PRODUCT_SPEC.md        what Aveline is, how it makes money
  API.md                 how to call the backend ← start here for the client
  ACCESS_CONTROL.md      who may do what
  INVITATION_DESIGN.md   templates, blocks, media, RSVP questions
  VENUES_AND_SEATING.md  venues, tables, seats
  PAYMENTS.md            card acquiring and the redirect flow

backend/         The API. Rules in backend/CLAUDE.md
  docs/                  backend-internal: architecture, schema, stores, gaps
  openapi.json           generated; feed it to a type generator

<client>/        The web or mobile client. Rules in its own CLAUDE.md
```

**The split that matters:** `docs/` is a contract between two teams.
`backend/docs/` is one team's internal reasoning. Changing something in
`docs/` affects someone who is not in the room — say so in the commit.

## 2. Working across the boundary

**The API is the contract, and `docs/API.md` is its description.** It is not
generated — it carries the conventions, the gotchas and the reasoning that an
OpenAPI schema cannot express. `backend/openapi.json` is generated and is what
a type generator should consume.

- **Backend:** changing a response shape means updating `docs/API.md` in the
  same commit. Adding a field is safe. Renaming, removing or retyping one is
  breaking — say so plainly in the commit message.
- **Client:** if the API does not do what you need, say so rather than working
  around it. A workaround in the client becomes permanent; a backend change
  takes an afternoon.
- **Neither:** do not invent an endpoint in a doc that does not exist in code.
  `backend/npm run docs:check` fails the build on exactly that.

## 3. Shared conventions

**Money** is integer minor units as a string: `"25000"`. Never a float. AMD
has no subunit, so that is twenty-five thousand dram.

**Translated content** is keyed by locale and resolved with a fallback. A
requested locale is negotiated against what an event publishes — render what
the response says, not what you asked for.

**Times** are ISO 8601 UTC. Events carry an IANA timezone; format in that
zone, not the viewer's.

**Capability links** — the long tokens in guest, ticket and vendor URLs — are
credentials. Keep them out of logs, analytics and screenshots.

## 4. Documentation

A doc that describes something that no longer exists is worse than no doc,
because it is believed.

- Update the governing doc **in the same commit** as the behaviour.
- Every doc carries a "not yet built" section. When you build something,
  delete its entry. Those sections rot fastest and are the first thing a new
  reader trusts.
- `cd backend && npm run docs:check` catches broken links, undocumented
  endpoints and endpoints documented but absent. It cannot read prose — a
  stale "not yet built" list is still on you.

## 5. Commits

- Explain **why**, not what the diff already shows.
- Say when a change is breaking for the other team.
- **Never commit competitor material.** Research sources stay on local disk;
  the gitignore blocks the usual shapes. The repository is currently public.
- Never commit secrets. `.env`, `garage/garage.toml` and credentials of any
  kind are ignored; templates are committed in their place.

## 6. Area rules

| Working in | Read |
|---|---|
| `backend/` | [`backend/CLAUDE.md`](backend/CLAUDE.md) |
| the client | its own `CLAUDE.md`; start from [`docs/API.md`](docs/API.md) |

Claude Code loads the nearest `CLAUDE.md` automatically, so an agent working
in `backend/` gets the backend rules without being told.
