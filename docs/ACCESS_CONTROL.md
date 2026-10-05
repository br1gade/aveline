# Access Control

Who can hold an account, what they may do, and how the people who are *not*
account holders — guests and vendors — reach what they need.

Implemented in [`backend/src/modules/access/access-policy.ts`](../backend/src/modules/access/access-policy.ts).

---

## 1. Four kinds of actor

Not every participant needs an account. Forcing guests to register would wreck
the product: a guest opens a link from a group chat and responds in thirty
seconds. Three of the four actor kinds below never see a login screen.

| Actor | Authenticates with | Why |
|---|---|---|
| **Platform staff** | Account | Aveline's own people: admins and concierge operators |
| **Organization member** | Account | The customer side: hosts, planners, their staff |
| **Guest** | Capability URL | A long unguessable token in the link. No password, no account |
| **Vendor** | Scoped brief token | Sees one event's brief, limited to declared scopes |

### Guests are capabilities, not accounts

Each guest row carries a unique `token`. The invitation link embeds it:
`/invitations/:slug/g/:guestToken`. Holding the link *is* the authorization.
This is deliberate — it is what lets an invitation be forwarded inside a family
group chat and still personalize for whoever opens it.

The trade-off is explicit: anyone with the link can respond as that guest. For
a wedding invitation that is correct behaviour. For an event where it is not,
the mitigation is a short-lived token, not an account.

### Vendors see one brief and nothing else

`VendorBooking.briefToken` grants access; `VendorBooking.briefScopes` lists
exactly which sections. The scopes are their own vocabulary — `headcount`,
`catering`, `bar`, `playlist`, `timeline`, `seating`, `households`,
`contacts` — rather than the staff permission names above, because a caterer
needs the headcount and the dietary requirements but has no business reading
the playlist, and `operations:read` cannot express that difference.

The brief is assembled by iterating the granted sections, so a section the
booking did not list cannot appear in the response. Omitting the scopes falls
back to the vendor category's usual set, which narrows rather than widens.
No scope exposes what another vendor is being paid, and `contacts` — the only
scope carrying phone numbers — is never granted by default.

A brief link is a capability, so rotation is its only revocation:
`POST /events/:eventId/vendors/:bookingId/rotate-brief` kills the old link.

---

## 2. Three role dimensions

A user's permissions are the **union** of what their platform role, their
organization role, and their event role grant. The union never escalates past
what each individually allows.

### Platform role — Aveline staff

| Role | Purpose |
|---|---|
| `NONE` | Every customer account. Permissions come from membership instead |
| `SUPPORT` | Concierge operator. Runs a customer's event on their behalf (spec §11) |
| `ADMIN` | Full platform access |

`SUPPORT` deliberately **cannot** delete an event or read billing. A concierge
operator needs to build invitations and manage guests; they do not need to
destroy a customer's event or see what they were charged.

### Organization role — the customer account

| Role | Purpose |
|---|---|
| `OWNER` | Everything, including deletion, billing and member management |
| `MANAGER` | Runs every event in the organization; cannot delete or manage members |
| `MEMBER` | Read-only across the organization |
| `VIEWER` | Read-only |

### Event role — one event at a time

A planner agency has staff who should touch three events, not thirty. Event
membership is how that is expressed.

| Role | Purpose |
|---|---|
| `OWNER` | Full control of this event, including deletion |
| `COORDINATOR` | Runs the event: guests, seating, operations, vendors |
| `DESIGNER` | Changes how the invitation looks — and nothing else |
| `VIEWER` | Read-only on this event |

**`DESIGNER` is the role worth explaining.** A freelance designer brought in to
style an invitation should not be able to read four hundred guests' phone
numbers, nor see what the caterer is charging. The role grants
`invitation:design`, `invitation:read` and `event:read`, and explicitly denies
`guest:contact:read`, `operations:read` and `vendor:fee:read`.

---

## 3. Permissions

| Permission | Covers |
|---|---|
| `event:read` / `event:write` / `event:delete` | The event itself |
| `guest:read` | Guest list, names, RSVP status |
| `guest:contact:read` | Phone numbers and email addresses — separated because it is PII |
| `guest:write` | Add, edit and remove guests |
| `invitation:read` | View the invitation |
| `invitation:design` | Change template, theme, blocks, media |
| `invitation:publish` | Make it live, close it |
| `operations:read` | Headcount, catering, bar, playlist, guest book |
| `seating:read` / `seating:write` | Tables and assignments |
| `vendor:read` / `vendor:write` | The vendor network for this event |
| `vendor:fee:read` | What vendors are being paid — separated from `vendor:read` |
| `member:manage` | Invite and remove members, change roles |
| `billing:read` | Invoices, plan and promo codes |
| `billing:write` | Change the plan, create and withdraw promo codes |

Two permissions are split out from their obvious parents on purpose:
`guest:contact:read` from `guest:read`, and `vendor:fee:read` from
`vendor:read`. Both exist so a `DESIGNER` can be useful without being trusted
with PII or commercial terms.

`billing:read` and `billing:write` are granted by organization `OWNER` and
platform `ADMIN` only — they are not part of `RUN_EVENT`. A planner running
someone's event can do everything operational without being able to change the
plan or issue a discount, because a discount is revenue.

---

## 4. Policy is a lookup, not a branch

`access-policy.ts` is a pure function over three lookup tables. Adding a role
means adding a row; it never means adding control flow. Two consequences:

- The whole policy is exhaustively testable without a database. 17 unit tests
  cover it, including an assertion that `ADMIN` holds every permission in the
  enum — so a newly added permission cannot silently default to denied for
  admins.
- Cyclomatic complexity stays flat as roles multiply, which is what the
  `complexity: 10` lint rule enforces elsewhere.

**Scope boundary:** the policy answers *"may this kind of actor do this kind of
thing"*. It does not answer *"is this actor attached to this event"* — that is
ownership, resolved by the guard that loads the membership. Keeping them apart
is what makes the policy a pure function.

---

## 5. How a session works

Accounts authenticate with email and password. A successful login returns a
short-lived **access token** (a JWT carrying only the user id, email and
platform role) and a long-lived **refresh token**.

Refresh tokens are stored as rows (`Session`) rather than trusted on their
own, because a JWT cannot be withdrawn before it expires and a staff account
that acts on customers' behalf must be revocable immediately. Only the
SHA-256 of each token is stored, so a database leak does not hand over live
sessions.

**Refresh rotates.** Presenting a refresh token revokes it and issues a new
pair, so a stolen token works at most once — and its use invalidates the
victim's session, which is how the theft becomes visible.

Roles are **never** read from the token. `AuthGuard` loads membership from the
database on every request, so removing someone from an event takes effect
immediately rather than when their token expires.

Two supporting models complete the lifecycle: `VerificationToken` for password
reset and email verification, and `OrganizationInvite` for adding a teammate —
separate, because an invitee may not have an account yet.

## 6. Not yet built

1. **Rotation for guest links and vendor briefs.** Account sessions rotate;
   capability tokens are still issued once and never replaced.
2. **Audit trail** — who changed what, which matters most for `SUPPORT` acting
   on a customer's behalf. Unblocked now that there is an actor to record.
3. **Per-actor rate limits.** The throttle is global rather than per account.
4. **Accepting an invite / resetting a password.** Both are modelled; neither
   has an endpoint.
