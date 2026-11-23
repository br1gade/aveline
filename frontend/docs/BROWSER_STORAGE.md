# What the client keeps in the browser

> **Status: inventory for the privacy notice (B3-01).** Written on 21 November 2026 from the code at
> `84bbbd2` plus the plan's Phase 1 work. The privacy notice is a marked placeholder until a lawyer has
> read it (design C-50, PD-194); this page lists the facts it must cover. Update it in the same change as
> any new key, cookie or cache.

Aveline sets no analytics, advertising or third-party cookies, and loads no third-party scripts. The
fonts are self-hosted. Everything below is set by Aveline's own pages on Aveline's own origin.

## Cookie

| Name | Holds | Why | Lifetime | Personal data |
|---|---|---|---|---|
| `aveline-lang` | The interface language chosen (`hy`, `ru`, `en`, `fr`) | So the next page opens in it | One year; `Path=/`, `SameSite=Lax`, `Secure` on https | No |

Source: `src/lib/i18n/negotiate.ts` (`languageCookie`), set only when the visitor chooses a language.

## Local storage (stays after the tab closes)

| Key | Holds | Why | Lifetime | Personal data |
|---|---|---|---|---|
| `aveline.refreshToken` | A signed-in host's or staff member's refresh token, a credential | To stay signed in across tabs and visits | Until sign-out, or the server ends the session (30 days by default) | A credential to the account. Moving it to a cookie is FR-12 |

Source: `src/api/session/token-store.ts`. The short-lived access token is kept in memory only.

## Session storage (this tab only; gone when it closes)

| Key | Holds | Why | Lifetime | Personal data |
|---|---|---|---|---|
| `aveline-organization` | The id of the organization this tab works in | An account in several organizations | The tab | No (an id, not a credential) |
| `aveline-reply-draft:<invitation>:<guest>` | A guest's reply while it is typed: who comes, answers, names, a message; never the agreements or signatures | A reload loses nothing (design PD-195) | Until sent, or the tab closes | Yes: the guest's answers |
| `aveline-checkout-draft:<event>` | An order while it is typed: the buyer's name, email and phone, the attendees' names and emails, the tickets chosen | A reload loses nothing (PD-152) | Until placed, or the tab closes | Yes: buyer and attendees |
| `aveline-checkout-key:<event>` | A random request key and a digest of the order | Pressing again doesn't place a second order | Until answered | No |
| `aveline-ticket-order` | The buyer's order link token, a credential, and the event it was placed for | The bank returns to a page with no token in its address (docs/API.md §5) | Until "Start a new order", or the tab closes | A credential to the order |
| `aveline-ticket-order-read` | The order as last read: attendees' names, tickets and their codes | The tickets open with no signal (PD-202) | Until the order is forgotten, or the tab closes | Yes: attendees, admission codes |
| `aveline-music` | `on` or `off` | The invitation's music choice | The tab | No |

Sources: `src/api/session/organization.ts`, `src/features/guest-reply/draft-store.ts`,
`src/features/checkout/draft-store.ts`, `src/features/checkout/key-store.ts`,
`src/features/ticket-order/token-store.ts`, `src/features/ticket-order/order-snapshot.ts`,
`src/features/invitation-renderer/components/music-choice.ts`.

## Service worker cache

| Name | Holds | Why | Lifetime | Personal data |
|---|---|---|---|---|
| `aveline-tickets-v1` (scope `/tickets`) | The tickets page's frame, which carries no token, and its scripts, styles and fonts | The tickets open with no signal (PD-202) | Until a release no longer names them | No |

Source: `public/tickets-sw.js`. The API is never cached.

## Not storage

Two other browser features are used, and neither keeps anything:
- the Web Locks API and a `BroadcastChannel` named for the session, which coordinate signing in and out
  between tabs;
- the clipboard, which receives a link only when a host presses Copy (PD-122, PD-213).
