# Pre-launch audit: business, UI/UX, phone and desktop

> **Status: findings only.** Run on 13 November 2026 against `dev` at `5c2f2a3`, written up on
> 14 November. Read-only: nothing in the repository was changed apart from this file. The local
> development stack was started for the audit and stopped afterwards.
>
> Three commits reached `dev` after the run (`1e0e472`, `018e975`, `cb6341e`): five more launch
> gates in `docs/GOING_LIVE.md`, staff accounts, and the visitor's address passed on from rendered
> pages. Nothing was run again on them. Every file and line cited below was checked again at
> `cb6341e`, and §6 takes in the new gates.
>
> "Launch" here means the first real invitation sent to a real guest, on the free pilot
> (`PILOT_MODE=true`). "Paid launch" means the first real charge.

## 1. Summary

**No-go today.** The product works end to end on a development stack, but it cannot carry a real
guest yet:

1. **Nothing is deployed.** There is no host, domain, TLS, sending domain or off-host backup (`docs/GOING_LIVE.md` §1).
2. **Russian and French guests receive Armenian emails,** and every account email is Armenian (F-02, F-08).
3. **The legal and trust gates are open:** the privacy notice is a placeholder, there are no terms, and no support contact is set (F-03, F-04).
4. **Three defects sit on core journeys:** a keyboard user cannot send a reply (F-06), Back after paying starts a second order (F-07), and the pilot refuses payment only after the whole form (F-09).
5. **The project's own content gates are open:** native reading of Armenian and Russian, the designer's approval and Aveline's own photographs (F-05).

What is ready: every journey in the repository's suite passes on Chrome at five widths, and the
screens hold their layout in four languages almost everywhere (§4).

## 2. How it was checked

| Check | Scope | Result |
|---|---|---|
| The repository's e2e suite, `frontend/test/e2e/` | 13 specs, Chrome at 360 and 1280 px | 90 of 90 passed, none skipped |
| The same specs at other widths | Chrome at 390, 768, 1920 px; WebKit at 390 and 1280 px | 220 of 225 passed; the five failures are WebKit's (F-17, F-30) |
| Screen probe | 64 screens × 4 languages × 5 Chrome widths, plus WebKit at 5 widths (English; Armenian too at 390 and 1280): 1,728 readings | Overflow, clipped text, `<html lang>`, fonts, sticky bars, 44 px targets; axe on 640 of them |
| Journeys driven through the screens | Guest reply and free checkout in hy, ru, en, fr; vendor brief; a new host from sign-up to import | §4 |
| Keyboard, zoom, text size, motion, contrast | Chrome at 1280 px, English | "What held up", F-06 |
| Phone conditions | Offline mid-action, refresh mid-form, a 380 px-high screen, Back; Chrome 360 px and WebKit 390 px | F-07, F-21, F-22 |
| Slow 3G | Production build, 50 KB/s, 2 s latency, 4× slower processor | F-23 |
| Email | Every message read from the local mail catcher | F-02, F-08, F-10 |
| Pilot mode | API restarted with `PILOT_MODE=true` | F-09 |
| Code and docs | Three read-only sweeps; every finding below re-checked at its file and line | |

Screenshots are under the ignored `frontend/test-results/audit-2026-11-13/`. No page whose address
or content holds a capability token was captured: guest, ticket and brief pages were read from the
page's own structure instead. Tokens in quoted addresses are written `<token>`.

## 3. Findings

41 findings: 5 blockers, 7 high, 23 medium, 6 low. "Blocks" says what a finding stops: **launch**
(the pilot's first real guest), **paid launch**, or **no**. Paths are from the repository's root.

### Blockers

| ID | Area | Severity | Evidence | Why it matters | Fix | Owner | Blocks |
|---|---|---|---|---|---|---|---|
| F-01 | business | blocker | `docs/GOING_LIVE.md:78` (no sending domain, SPF, DKIM or DMARC), `:87-91` (secrets, origin, backup destination, host and domain), `:44-45` (the suite has never run against staging) | Nothing can be verified under real conditions, and mail without DNS records is filed as spam | Provision the host, DNS, TLS and SMTP; deploy a staging release; run the e2e suite against it | hosting | launch |
| F-02 | i18n | blocker | Local stack, 13 Nov, 1280 px: four guests with `locale` en, hy, ru, fr were sent the invitation from "Publish and send". The ru and fr guests received the subject "Հրավեր Anna & Davit-ից" and an Armenian body; only the data-request footer line was in their language. The reply confirmation was Armenian for both too. Cause: `backend/src/modules/communications/communications.service.ts:590-591` falls back to `'hy'`; `backend/src/seed/message-copy.ts` has ru and fr copy for 2 of its 16 messages | C-5 promises Russian fully supported. A Russian or French guest cannot read the invitation that carries their link | Write ru and fr copy for all 16 messages. Fall back to the event's default language, then English, not Armenian | backend, native readers | launch |
| F-03 | legal | blocker | `/privacy` opens with "This is a placeholder… Don't rely on it until then" (`frontend/src/features/privacy-request/components/privacy-notice-page.tsx:15,30`). It names no legal entity, address or lawful basis. No terms of service exist: no route in `frontend/src/routes.ts:20-125` and no mention in any locale; `docs/GOING_LIVE.md:97` lists the gap since 13 November (13d). `/register` links to neither (`frontend/src/features/account/components/register.tsx:24,61`) | Hosts upload guests' personal data with no notice to rely on and no terms to accept. C-50 already makes this a gate | Draft the notice and terms; have a lawyer read both and the data-request form; link both from sign-up, checkout and the invitation's footer | legal, product; client for the links | launch |
| F-04 | legal | blocker | `/help` says "Ways to reach us aren't listed here yet." The same line appears in the privacy notice, on the ticket order page and on the billing return page, which tells the payer to "contact us" (`frontend/src/lib/support/contacts.ts:21-34`, `frontend/src/ui/support-contacts.tsx:15`). Nothing fails a build when the settings are empty (`frontend/src/config/env.ts:41-49`) | A guest, buyer or host with a problem has nobody to reach, including after a payment dispute. C-54 is a gate | Set `VITE_SUPPORT_EMAIL`, `_PHONE`, `_WHATSAPP`, `_TELEGRAM`; make a production build refuse to start without at least one | product, hosting | launch |
| F-05 | i18n | blocker | `frontend/docs/design/README.md:137-145`: native readers have not read the Armenian and Russian copy (PD-9); placeholder photographs are third-party (C-34); the designer has not approved the screens; the palette stand-in is neither replaced nor accepted (PD-21) | These are the project's own launch gates. Only the photographs are in `docs/GOING_LIVE.md` (F-36) | Book the native readers (§7 lists what to read first); get the designer's sign-off or a written waiver | outside party, product | launch |

### High

| ID | Area | Severity | Evidence | Why it matters | Fix | Owner | Blocks |
|---|---|---|---|---|---|---|---|
| F-06 | a11y | high | Guest page, 1280 px, English, an event with two sides. Tab to "Your answer", press Space on "Joyfully attending", Tab to "Send reply", press Enter. Result: "Please check your reply. Some answers could not be saved", linked to `#reply-attribution`; no field is marked invalid and no request is sent. Sending the same answers by tap returns 201. Narrowed down at 360 px: focusing an unchosen "Who invited you? · Optional" choice and leaving it is enough, while tapping into the text boxes is harmless. Field: `frontend/src/features/guest-reply/components/detail-sections.tsx:88`; rule: `frontend/src/features/guest-reply/form-model.ts:281` accepts `''`, `:163` starts there | A keyboard, switch or screen-reader user cannot send a reply without answering a question marked optional, and the error does not say which. Sides are on by default (C-30). Fails WCAG 2.1.1 and 3.3.1 on the core journey | Keep the empty value when no choice is made; word the error for the field | client | launch |
| F-07 | phone | high | Checkout, 360 px and WebKit 390 px, English. Buy one paid ticket, pay at the fake bank, see the tickets, press the browser's Back. Result: the checkout form with the buyer's details still filled and "Continue to payment" live, no notice. Pressing it places a second order: two `201` answers, two bank references, and the host's list holds `PAID` and a new `RESERVED` order for the same buyer. The same happens while the bank is still waited for. The retry key is kept only "while its press is unanswered" (`frontend/src/features/checkout/key-store.ts:4-8`, PD-152) | A buyer who goes Back, as people do after a bank page, can pay twice. Before paying, a second set of tickets is held for 15 minutes | Replace the checkout entry in history once an order exists, or show that order on return. Server side, answer the same buyer and basket with the open order | client, backend | paid launch |
| F-08 | i18n | high | A host asked for a password reset and received "Գաղտնաբառի վերականգնում" with an Armenian body. `backend/src/infra/auth/account.service.ts:58` sets `DEFAULT_LOCALE ?? 'hy'` and `:106` uses it for every account email, whatever language the host uses: reset, confirm address, team and organization invitations | A Russian-, English- or French-speaking host cannot read the mail that restores their account or invites them to a team | Send the interface language with the request and store it on the account | backend, client | launch |
| F-09 | business | high | `PILOT_MODE=true`, 360 px, English. Neither the event page, the checkout nor the host's ticket pages say paid tickets cannot be bought. A buyer chooses an AMD 15,000 ticket, fills 11 fields, presses "Continue to payment" and only then reads "Paid tickets can't be bought yet: Aveline is running as a free pilot." A host can create and publish a paid ticket type with no warning. Known: FR-64, FR-109, PD-127 | The pilot is exactly the mode this happens in. Buyers lose their effort; hosts advertise tickets nobody can buy | Backend says whether payments are on (FR-64, FR-109); the client says so on the ticket type form, the event page and the price list | backend, client | launch, unless pilot hosts are told not to price tickets |
| F-10 | business | high | Every message read on 13 Nov: From "Aveline <hello@aveline.test>", no `Reply-To`, no `List-Unsubscribe` (`backend/src/modules/communications/channels/smtp.transport.ts:75-84`). The invitation's body is "Dear …, you are warmly invited to Anna & Davit", the link and the data-request line: no date, no venue, nothing on why the guest received it or how to stop further messages. The ticket mail is "Thank you, Ani Grigoryan. Your tickets: <link>": no event, date or order. No message carries a support contact | A reply goes to an unread mailbox. A message with a bare link and no context reads as phishing and is reported as spam, which hurts delivery for every host | Add `Reply-To` (the host or support), `List-Unsubscribe`, the event's date and place, and a "why you got this" line | backend, product | launch for the sender; the content should follow before real guests |
| F-11 | phone | high | The door at 360×800 and WebKit 390×844: 676 px are used before the search box (header, the email-confirmation notice, back link, title, counts, tabs). The first result's "Check in" button sits at 98–103% of the screen's height | Door staff must scroll for every guest, one-handed, in a queue | On the door, drop the notice and "Sign out on every device", shrink the counts, keep the search at the top | client | no; fix before the door rehearsal (FR-76, FR-79) |
| F-37 | business | high | Paid tickets are sold for a host's event, but nothing says how the money reaches the host or what Aveline keeps. `docs/PAYMENTS.md:329-343` lists payouts to vendors as not built and mentions none to hosts; `backend/prisma/schema.prisma` has no payout or settlement model; `docs/PRODUCT_SPEC.md:312-323` lists six revenue lines and ticketing is not one of them | The money would sit in whichever bank account holds the merchant agreement. A host cannot be told when or how they are paid | Decide who the seller is, the fee and the payout; then build or document it | product, backend | paid launch |

### Medium

| ID | Area | Severity | Evidence | Why it matters | Fix | Owner | Blocks |
|---|---|---|---|---|---|---|---|
| F-12 | UX | medium | After sign-up through `/register`, `/app` shows "Confirm your email address: we sent a link to …" (`frontend/src/locales/en/app.json:74`, PD-191). No mail was sent: the mail catcher held nothing for the new host, and `register` sends none (`backend/src/infra/auth/account.service.ts:145-157`) | The host looks for a message that does not exist. The line is on every signed-in page | Send the confirmation at sign-up, or word the line as "Confirm your email address" with "Send the link" | backend or client | no |
| F-13 | UX | medium | Event overview, every width (`frontend/test-results/audit-2026-11-13/screens/c360/en-app_events_id.png`, `focus-app-event-c1280.png`): 18 buttons of equal weight in no order of work; "Publish and send" is the fourteenth. Straight after creating an event the page has no primary action. A wedding shows "Ticket sales" and "Orders" | A new host does not know what to do next. The app has no other navigation between an event's pages | Group the links by stage (set up, invite, run the day) and lead with the next step; the publish page's own checklist is a good model | client, designer | no |
| F-14 | desktop | medium | Guest list at 1920×1080 (`screens/c1920/en-app_events_id_guests.png`): one 830 px column, the rest empty; about 2.5 households a screen; six households take 101 Tab stops; no sorting, no columns. Every app page starts with four header stops and has no skip link. Seating is the same single column (`screens/c1920/en-app_events_id_seating.png`) | The desktop-first journeys are a phone layout centred on a wide screen. A 150-guest list is roughly 25 screens of scrolling | A denser row or table at wide widths, row actions in a menu, a two-pane seating view, a skip link | client, designer | no |
| F-15 | i18n | medium | `/no-such-page` and an expired or mistyped invitation link render "This page isn't available. Check the link you received." with `<html lang="en">`, whatever the cookie or `Accept-Language` (hy, ru, fr tried). `frontend/src/routes/not-found.tsx:15-23`; `frontend/src/lib/i18n/page-language.ts` falls back to the source language | An Armenian or Russian guest whose link has expired reads English | Negotiate the language on the not-found route as the public pages do | client | no |
| F-16 | phone | medium | Guest page at 360 and 390 px, Chrome and WebKit, all four languages: a long member name makes the page scroll sideways. `frontend/src/features/invitation-renderer/components/personal-card.tsx:41` sets `whitespace-nowrap` on each name, so it cannot wrap. Seen with "Աննա-Մարիա Տեր-Հովհաննիսյան-Մելիք-Շահնազարյան" (44 characters) and "Константин Константинопольский-Преображенский"; the shortest name that overflows was not measured. The tickets page does the same for a 35-letter unbroken first name (`frontend/src/features/ticket-order/components/ticket-list.tsx:76`) | Double-barrelled Armenian and Russian names are common. The repository's own check misses it, as its guests have short names | Let names wrap at hyphens and spaces; add `overflow-wrap: anywhere` to the holder's name | client | no |
| F-17 | phone | medium | WebKit, iPhone profile, 360 and 390 px: the ticket quantity menu on `/events/<slug>` is 27 px high. `frontend/src/features/public-event/components/ticket-picker.tsx:70-74` relies on `min-h`, which WebKit ignores on a native menu. `frontend/test/e2e/a11y.spec.ts` fails there on WebKit ("select 350×27") | The first control a buyer touches is under the 44 px target on iPhones | Give the menu an explicit height or `appearance: none` with its own arrow | client | no; confirm on a real iPhone |
| F-18 | a11y | medium | `/app/events/<id>/guests` at 360 px (hy, ru, fr) and WebKit 390 px (en, hy): axe `target-size`, serious, on a household's row actions when names are long | Row actions overlap under WCAG 2.5.8 on a phone | Stack the actions or move them into a menu (see F-14) | client | no |
| F-19 | UX | medium | Errors shown as red text with no icon in 18 places, for example `frontend/src/features/checkout/components/promo-code.tsx:128`, `frontend/src/features/checkout/components/attendee-card.tsx:47`, `frontend/src/features/door/components/ticket-scanner.tsx:60`, `frontend/src/features/guest-agreements/components/statement-card.tsx:75,189`. The backend's English sentence is shown inside hy, ru and fr pages at `frontend/src/features/sending/components/refusal-alert.tsx:14-16`, `frontend/src/features/venues/components/remove-venue-dialog.tsx:50-52`, `frontend/src/features/seating/components/shared.tsx:33-34`, `frontend/src/features/exports/components/shared.tsx:61-62`. The last-resort error page offers no link or button (`frontend/src/root.tsx:78-90`) | The project's rule is an icon and words (`frontend/CLAUDE.md` §5). Colour alone fails WCAG 1.4.1. An English reason in an Armenian page is unreadable to some hosts | Use the shared `Notice` or `ProblemAlert`; give the refusals stable codes (FR-20, FR-28, FR-32, FR-58) | client, backend | no |
| F-20 | UX | medium | "Stop replies" (`frontend/src/features/sending/components/replies-panel.tsx:62`) and "Unpublish" an announcement (`frontend/src/features/ticket-sales/components/announcement-panel.tsx:135`) act on the press, with no question | One closes replies for every guest, the other takes a public sales page down. Both can be undone, but guests and buyers meet the result meanwhile | Ask first, as every other such action does | client | no |
| F-21 | phone | medium | Refresh in the middle of a form, 360 and 390 px: the guest's chosen answer and typed message are gone; the buyer's name and email are gone. Whether a phone browser asks before leaving was not seen. Offline is handled well: both say what happened with an icon, and pressing again succeeds once without a duplicate | A phone that reloads the tab loses a long checkout (11 fields for one ticket) | Keep the draft in the tab's session storage | client | no |
| F-22 | phone | medium | The tickets page, 360 px, Chrome: reloaded with no connection, it shows the browser's error page; it offers no way to save a ticket (no file, no wallet, no hint to keep a screenshot). C-40 covers the door's connection, not the buyer's | A buyer at a venue with poor signal who reloads has no ticket to show | Say "take a screenshot before you come" at least; later, keep the page for offline | client, product | no |
| F-23 | phone | medium | Production build on slow 3G with a slow processor, uncompressed: the guest page shows its heading after 2.5 s but can be replied to only after 29 s (956 KB of script); the tickets page shows its code after 27 s; the door's search box appears after 54 s (1,983 KB of script). Caddy compresses (`backend/Caddyfile:38`), which should cut transfer to roughly a third | The door and a ticket are opened in exactly the places with bad signal | Measure behind the real proxy; split the door and the scanner out of the app's bundle; render the ticket's code on the server | client | no |
| F-24 | business | medium | Checkout before paying shows the price and "You pay on your bank's own secure page. Your tickets are held for you for 15 minutes." It names no seller, no refund or cancellation rule, no tax line and no terms (`frontend/src/features/checkout/components/place-order.tsx:42-61`). `/pricing` likewise. Invitation, event and checkout pages have no privacy or help link | Card schemes and consumer law expect the seller and the refund terms before payment. The buyer does not know whether they are paying Aveline or the host | Name the organizer and Aveline's role; state the refund rule; link the terms and the privacy notice | product, legal, client | paid launch |
| F-25 | business | medium | `/pricing` and `/app/billing` list a plan's features as raw keys: "seating", "check-in", "operations", "vendor-briefs", "thank-yous", and "99 languages" (`frontend/src/features/billing/components/plan-list.tsx:34-38`; FR-110). Plan limits are published but not enforced (`docs/API.md:4011`), which C-48 accepts | The public price list reads as unfinished and stays English in every language | Backend sends plan copy per language (FR-110) | backend | paid launch |
| F-26 | business | medium | `/` is a placeholder with four links and no way to sign in or create an account (`frontend/src/routes/home.tsx:21-44`). Home, `/pricing`, `/events` and each public event page tell search engines not to index them; the event's rule comes from the API (`frontend/src/features/public-event/meta.ts:42`). A public event without an image gets no preview image | A host cannot get from the front page to the app. Public ticketed events cannot be found by search | Decide whether public events and the price list should be indexed; add account links to the home page; set a default share image | product, client | no |
| F-27 | business | medium | What can be counted (§8): per event, in the app; across events, only by SQL. No staff page shows sign-ups, events, invitations sent, reply rates or tickets sold. Invitation views count every page load, not people; email opens are not recorded | The pilot's success cannot be read without a developer | A small staff page of counts over the existing tables | backend, product | no |
| F-28 | business | medium | `backend/src/modules/payments/pilot-payments.ts:5` refuses charges only when `PILOT_MODE` is exactly `true`, and `backend/src/common/env.validation.ts:45` does not require it. Only the compose default protects (`backend/docker-compose.prod.yml:95`) | A deployment that drops the variable charges for real | Require `PILOT_MODE` in production | backend | paid launch |
| F-29 | legal | medium | From reading the code, not run: sessions are never deleted, so IP address and browser are kept without limit (`backend/prisma/schema.prisma:121-122`); request logs keep both; login and password reset have only the general rate limit, no lockout (`backend/src/infra/auth/auth.controller.ts:34-35,59-60`); the Telegram bot token is part of the request address (`backend/src/modules/communications/channels/telegram.transport.ts:48`) and Sentry has no breadcrumb filter (`backend/src/infra/observability/sentry.ts:18-34`); the refresh token is in `localStorage` (`frontend/src/api/session/token-store.ts:22-39`, FR-12) | Each is a privacy or account-safety gap that is in no launch list | Add them to GOING_LIVE and decide each | backend | no; decide before launch |
| F-30 | UX | medium | The browser console logs React's "Encountered a script tag while rendering React component" on 24 of 1,728 page loads, on both engines, and every time on WebKit when a host leaves for the bank. The journey still completes, but `frontend/test/e2e/billing.spec.ts` fails on WebKit because of it | It suggests the page shell is rendered again in the browser. Development build only; not checked on the production build | Find what re-renders the document; run the suite on WebKit in CI | client | no |
| F-31 | UX | medium | Guest import: the link says "Import a spreadsheet" but only CSV is taken; no sample file is offered; an `.xlsx` file answers "The file has headings but no guests"; French headings ("Prénom, Nom") are refused (`backend/src/modules/guests/import/csv-guests.ts:42-43` knows English, Armenian and Russian). Semicolons, tabs, Armenian and Russian headings and a wrong encoding are all handled well | Import is where a host with 150 guests starts. The first try is often an Excel file | Offer a sample file; name a workbook as one; add French headings | client, backend | no |
| F-32 | i18n | medium | Armenian text in capitals: the guest page's date line reads "ԵՐԵՒԱՆԻ ԺԱՄԱՆԱԿՈՎ". CSS capitals turn "և" into "ԵՒ"; modern Eastern Armenian writes "ԵՎ". Buttons are set in capitals too (`frontend/src/ui/button.tsx:22`), and 608 Armenian strings hold "և" | A native reader will see a spelling error on the invitation's first screen. To be confirmed by one | Do not capitalise Armenian by CSS, or replace "և" before capitals | client, native reader | no |
| F-33 | i18n | medium | Russian uses both "событие" and "мероприятие" for "event" (`frontend/src/locales/ru/activity.json:2` "Назад к событию", `frontend/src/locales/ru/checkout.json:2` "Назад к мероприятию"). `frontend/src/locales/ru/customers.json:23` uses the wrong plural form. The Help page tells French readers "Nous répondons en arménien, en russe et en anglais" (`frontend/src/locales/fr/common.json:43`), which C-54 decided | One word per thing; the plural is a staff-only screen | For the native reader (§7) | native reader, product | no |
| F-38 | business | medium | After a host pays for a plan (fake bank, 1280 px): "Your payment is confirmed, and your plan is active", then "Active until 13 December 2026", "Cancel at the end of the period" and one invoice row, "Paid AMD 25,000". The invoice "isn't a tax document" (`frontend/src/locales/en/billing.json:96`), cannot be downloaded or printed (`frontend/src/features/billing/components/invoice-list.tsx:71-81`), and no email follows: none of the 16 messages is a receipt. Nothing renews (`billing.json:18`). A host has no way to ask for a refund in the app | A business host needs a document for their accounts, and a period that lapses silently loses the plan | A receipt by email, a printable invoice, a reminder before the period ends | backend, product | paid launch |

### Low

| ID | Area | Severity | Evidence | Why it matters | Fix | Owner | Blocks |
|---|---|---|---|---|---|---|---|
| F-34 | UX | low | Raw colours in the kit: `text-white` (`frontend/src/ui/kit/button.tsx:13`), `bg-black/50` (`frontend/src/ui/kit/dialog.tsx:28`, `alert-dialog.tsx:29`), `bg-black/80` (`frontend/src/features/gallery/components/photo-viewer.tsx:38`). The kit's focus ring is 3 px at half strength, about 3.4:1 by calculation, not the token's 2 px solid line | The rule is tokens only; two focus styles in one product | Map them to tokens | client | no |
| F-35 | UX | low | Small inconsistencies: the event overview shows the zone as "(Asia/Yerevan)" (`frontend/src/features/events/components/event-overview.tsx:72`) where guests read "Yerevan time"; the bank wait says "Held for 16 more minutes" after "held for 15 minutes"; "All" filters are 42 px wide; about half of all text has a fixed pixel size, the smallest 11 px; a "couldn't reach Aveline" notice stays after the connection returns; a venue typed by the host has no map link; the calendar file is named `event.ics` and, for an event with no end, has a start only | Each is a small doubt for the reader | Tidy each | client | no |
| F-36 | business | low | Docs disagree: of the design launch gates only the photographs are in `docs/GOING_LIVE.md`, while native reading, the designer's approval and the palette stand-in are not (`frontend/docs/design/README.md:137-147`); `docs/PRODUCT_SPEC.md:302` points to §12 for prices, which are in §14 (line 530); `docs/TODO.md:45-47` says the client is on a separate branch; `frontend/docs/BACKEND_REQUESTS.md:3` says "not yet triaged"; `docs/GOING_LIVE.md:143` says 1,170 tests, `backend/docs/EXPORT_RENDERERS.md:101` says 2,040 | A doc that is wrong is believed (`CLAUDE.md` §4) | Bring them into line | both teams | no |
| F-39 | legal | low | No cookie banner exists. The client sets one cookie, `aveline-lang`, for a year, only when a visitor picks a language (`frontend/src/lib/i18n/negotiate.ts:34-35`); it keeps the sign-in in `localStorage` and an order's key in `sessionStorage`; it loads nothing from third parties and has no analytics. No page mentions cookies or browser storage | A banner is probably not needed for storage this narrow, but the notice should say what is kept. For the lawyer | List the cookie and the stored items in the privacy notice | legal | no; part of F-03 |
| F-40 | UX | low | One action, several names: "Save" (9 buttons) and "Save changes" (4, for example `events:edit.submit`); "Create account", "Create an account" and "Create your account"; "Check in" (`door:row.checkIn`) and "Admit" (`door:code.admit`); guests "answer" in 98 strings and "reply" in 29 | Small, but it is what a translator and a reader trip on | Pick one of each | client | no |
| F-41 | UX | low | Loading and empty states, from reading the code: no page has a placeholder while it loads, as lists come with the page; the shared submit button only goes grey, with no "sending" words (`frontend/src/ui/app-form/submit-button.tsx:17-24`); the photo moderation buttons are never disabled, so a double tap sends twice (`frontend/src/features/gallery/components/moderation-card.tsx:62`); an empty venue list says "No venues yet" with no action beside it (`frontend/src/features/venues/components/venue-list.tsx:225`); an empty list of team invitations shows nothing (`frontend/src/features/organization/components/invites.tsx:133`) | A dead-looking button and an empty area both make a host press again | Say "Saving…"; disable while sending; give each empty list its action | client | no |

### What held up

- **Layout:** no sideways scroll and no clipped or spilling text on any of the 64 screens in any language at any width, apart from F-16. Russian and French strings fit.
- **Zoom:** eleven key pages reflow cleanly at 200% and at 400% (320 px).
- **Fonts:** the four Noto families load; no italic anywhere; `font-synthesis: none`; one `h1` on every page.
- **Language:** `<html lang>` matches the language shown on every page except the not-found page (F-15).
- **Times and money:** guest and public pages show the same time from a Yerevan and a Los Angeles browser, marked "Yerevan time" in each language. AMD has no decimals: "AMD 25,000", "25 000 ֏", "25 000 AMD".
- **Motion:** nothing animates under `prefers-reduced-motion`.
- **Keyboard:** every stop has a visible focus indicator on the 18 pages walked; the dialog traps focus and returns it.
- **Announcements, sampled:** a sent reply moves focus to "Thank you"; a refused one moves it to the error summary; the button reads "Sending…" while it waits; sign-up marks each wrong field and says why.
- **Small screen:** with 380 px of height, as under a keyboard, the focused field stays in view and no bar covers it. The guest's reply bar leaves while the form is on screen. The door's result panel takes 187–209 px at the bottom.
- **Tables:** the app has one, the headcount, in a region that scrolls and takes keyboard focus; everything else is a list that stacks.
- **Asking first:** removing, archiving, cancelling, sending and signing out everywhere all ask, apart from F-20.
- **Bad connection:** reply, checkout and check-in each say what happened and are safe to press again.
- **Tokens:** "Add to calendar" holds no token; ticket and brief links drop the token from the address; previews of personal links never name the guest; mailed links point at the client's own origin.

## 4. Journeys

Pass (✓) or fail (✗) by width and language. "Driven" means walked through the screens; "probed"
means every screen was rendered and read for layout, language and axe, with its actions not pressed.

**Chrome, English, driven (the repository's specs):**

| Journey | 360 | 390 | 768 | 1280 | 1920 |
|---|---|---|---|---|---|
| Host: sign up, organization, sign in, reset | ✓ | ✓ | ✓ | ✓ | ✓ |
| Host: create event, venue, publish, import | ✓ | ✓ | ✓ | ✓ | ✓ |
| Host: send, delivery, reminders | ✓ | ✓ | ✓ | ✓ | ✓ |
| Host: seating by hand and automatic | ✓ | ✓ | ✓ | ✓ | ✓ |
| Host: exports (PDF, XLSX, CSV) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Host: door (name, code, walk-in) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Host: paid plan, paid and declined | ✓ | ✓ | ✓ | ✓ | ✓ |
| Guest: reply, change, replies closed | ✓ | ✓ | ✓ | ✓ | ✓ |
| Buyer: listing, free and paid ticket | ✓ | ✓ | ✓ | ✓ | ✓ |
| Vendor: brief, paused brief | ✓ | ✓ | ✓ | ✓ | ✓ |

**WebKit, English, driven:** everything passes at 390 and 1280 px except the event page's target
check at 390 px (F-17) and the paid plan's console error at both (F-30).

**Four languages:**

| Journey | hy | ru | en | fr | How |
|---|---|---|---|---|---|
| Guest reply by tap, 360 px | ✓ | ✓ | ✓ | ✓ | driven |
| Guest reply by keyboard, 1280 px | not run | not run | ✗ F-06 | not run | driven |
| Guest's emails | ✓ | ✗ F-02 | ✓ | ✗ F-02 | read |
| Buyer: free ticket, 360, 1280, WebKit 390 | ✓ | ✓ | ✓ | ✓ | driven |
| Vendor brief, same three | ✓ | ✓ | ✓ | ✓ | driven |
| Guest, ticket, brief screens, five widths | ✓; ✗ F-16 at 360, 390 | same | same | same | probed |
| Public screens, five widths | ✓; ✗ F-15 | ✓; ✗ F-15 | ✓ | ✓; ✗ F-15 | probed |
| Host's 45 screens, five widths | ✓; ✗ F-18 at 360 | ✓; ✗ F-18 | ✓ | ✓; ✗ F-18 | probed |
| Host's emails | ✓ | ✗ F-08 | ✗ F-08 | ✗ F-08 | read, and by the code |

**Where a person stalls:**

- **Host.** At the front page, which has no way in (F-26). After sign-up, looking for a mail that was not sent (F-12). On the new event's page, with eighteen equal buttons (F-13). At import, with an Excel file (F-31). On a desktop with a long list (F-14). At the door on a phone (F-11). Sign-up, the organization form, the event form's errors and the publish checklist are clear.
- **Guest.** A Russian or French guest stalls at the email (F-02). A keyboard user stalls at Send (F-06). Everyone else replies in under a minute; changing the reply works.
- **Ticket buyer.** In the pilot, at the last step of a paid ticket (F-09). After paying, the Back button (F-07). At the door without signal (F-22). The free path is clean in all four languages.
- **Vendor.** Nothing found. The brief opens, drops its token from the address and reads in the browser's language.

## 5. Product against the spec

`docs/PRODUCT_SPEC.md` promises "the operating system for an event", with the invitation as its
front door. The core loop it describes is built and works: invitation, guest list, replies,
headcount, seating, sheets for catering and bar, exports, the door, reminders and thanks, vendor
briefs.

| The spec says | What is built |
|---|---|
| Three tiers: Invitation, Managed, Production (`docs/PRODUCT_SPEC.md:282-300`) | Four plans are seeded: `invitation-free`, `managed`, `production`, `planner-monthly`. Only the free one is on sale; the others have a price of 0 and are off (`backend/src/seed-production.ts:144-205`) |
| Price points | None is set. The spec leaves them open (`docs/PRODUCT_SPEC.md:530`) |
| The pilot is free; limits are published, not enforced (`docs/PRODUCT_SPEC.md:302`) | So it is. A host with no plan at all made a four-language event with seating, the door, exports and a vendor brief. The invitation's 90-day life is the one limit enforced |
| Paid plans through the card acquirer | Works against the fake bank only. No merchant account, no real bank test, no certification (`docs/GOING_LIVE.md:66-72`) |
| Paid tickets | Sold and settled against the fake bank. How the host is paid is undefined (F-37). Back can order twice (F-07) |
| Invoices and refunds | An invoice row on screen that is not a tax document; no receipt, no download, no renewal (F-38). Refunds are built against the fake bank and have never moved money (`docs/GOING_LIVE.md:72`) |
| Six revenue lines (`docs/PRODUCT_SPEC.md:312-323`) | Only the plan and ticket payments have code. Vendor referral, corporate contracts, add-ons and deposits are not built |
| Guests reached by email, Telegram, WhatsApp, SMS | Email sends; Telegram is said to (`docs/API.md:4003`) and was not tried. WhatsApp has no approved templates and SMS has no provider, yet the sending page names both |

## 6. Launch gates

Every open item from `docs/GOING_LIVE.md` and the "not yet built" lists, sorted. A readiness sweep
checked each against the code.

### Launch blockers

| Gate | Owner |
|---|---|
| Host, domain, TLS, secrets (`JWT_SECRET`, `CORS_ORIGINS`, `PUBLIC_APP_URL`); a staging release (GL #8–#11, FR-11) | hosting |
| Sending domain with SPF, DKIM, DMARC; delivery proven with the chosen provider (GL #6, #7) | hosting, outside party |
| Off-host backup destination, timers, a restored copy (GL #10) | hosting |
| Privacy notice, terms and consent at sign-up, data-request wording read by a lawyer (C-50, GL #13d, F-03, F-39) | legal |
| Support contacts set (C-54, F-04) | product |
| Russian and French message copy; account mail in the host's language (F-02, F-08) | backend |
| Native reading of Armenian and Russian (PD-9) | outside party |
| Designer's approval, own photographs, palette stand-in decided (design README §6) | product, designer |
| Keyboard reply (F-06) | client |
| The e2e suite on staging at both widths; frontend CI enabled (GL:56) | client, hosting |
| Four-language host and guest walkthrough on the real host (GL:26) | product |
| The first admin and support staff named, registered and granted; they check a requester's identity before fulfilling a data request (GL #13, #13b, C-53) | product, hosting |

### Needed for the pilot

| Gate | Owner |
|---|---|
| Say that payments are off before the form (F-09; FR-64, FR-109) | backend, client |
| Door rehearsal on real phones, with a real camera reading a real code (FR-76, FR-79) and the phone layout (F-11) | client, product |
| Workers deployed and watched: export, seating, private media; private bucket refuses anonymous reads (GL:164-186) | hosting |
| Gallery and acknowledgements accepted in four languages (GL:180) | product |
| `SENTRY_DSN` set, or another way to hear of errors and overdue data requests (GL #17) | hosting |
| Legacy invitation lifetimes reviewed; expiry proven on the host (GL:192-206) | backend, hosting |
| Renderer: decide which layouts, fonts and palettes it draws (FR-42, FR-9) | product |
| A way to count the pilot (F-27) | backend |
| Email content and headers (F-10); the sign-up line (F-12) | backend |
| Telegram, if it is on: register the webhook, then rehearse the opt-in (GL #7c, #7b) | backend, hosting |
| Load test of guest pages through the proxy and the rendering server (GL #13c) | hosting, backend |
| SMS: decide whether the pilot needs it; phone-only guests are unreachable (GL #12b) | product |

### After launch

| Gate | Owner |
|---|---|
| Merchant account, sandbox run, certification, real refund, bank order lifetime (GL #1–#5, #4b, #4c); F-07, F-24, F-25, F-28, F-37, F-38 | outside party, backend, client, product |
| Renewal, tax on invoices, plan limits enforced (GL §2) | backend, product |
| WhatsApp account and templates (GL #12) | outside party |
| Zero-downtime deploys, replicas, CDN, shared rate limits, log shipping (GL #14, #15, §2) | hosting |
| Offline door (C-40), seat map, guest-link rotation, email verification enforced | client, backend |
| Multiple organizations, template authoring, staff intake (GL:215-235) | backend, product |
| Desktop density, event overview, import polish (F-13, F-14, F-31) | client, designer |

## 7. Content: what a native reader checks first

No string in Armenian or Russian has been read by a native (PD-9). French was never to be (C-23);
it reads as translated French, with no untranslated strings found. Key parity is complete in all
four languages, and placeholders match.

Read in this order. Words are English counts.

1. **Backend messages** (`backend/src/seed/message-copy.ts`): 16 messages, 14 of them in Armenian and English only. Russian and French must be written, not just read (F-02).
2. **The invitation and reply:** `invitation` (327 words), `reply` (427). Check the capitals (F-32) and the several Armenian and Russian wordings of "Not sure yet".
3. **Tickets:** `public-event` (130), `checkout` (614), `ticket-order` (290), `guest-agreements` (145).
4. **Trust pages:** `privacy-request` (337), `common` (142), the guest part of `gallery`.
5. **The vendor's brief:** `brief` (300).
6. **Sign-up and money:** `account` (359), `billing` (818), `app` (470), `organization` (610).
7. **The host's daily screens:** `guests` (1,235), `events` (1,370), `sending` (968), `door` (839), `seating` (1,344), `follow-ups` (936).
8. **The rest of the app,** then the three staff namespaces.

Known before reading: "событие" and "мероприятие" for one thing (F-33);
`frontend/src/locales/hy/guests.json:163` keeps Excel's "CSV UTF-8 (comma delimited)" in English
where Russian translates it.

Copy that promises more than is built: the sending page says guests are reached "by email, or on
Telegram if they use it", and names WhatsApp and text messages, while WhatsApp has no approved
templates and SMS has no provider (`docs/API.md:4003`). The plan list shows limits nothing enforces
(C-48 accepts this). The sign-up line says a mail was sent (F-12).

## 8. Measurement

| Question | Can it be answered today? |
|---|---|
| Sign-ups, organizations | SQL only |
| Events created | SQL only; a staff search shows a count per organization |
| Invitations sent, delivered | Per event in the app; across events by SQL |
| Share of guests who reply | Per event in the app (the headcount); across events by SQL |
| Invitation views | Per event; counts page loads, not people; kept 395 days (`backend/src/infra/analytics/analytics.service.ts:11`) |
| Email opens | Not recorded |
| Tickets sold | Per event and type in the app; revenue totals by SQL |

No measurement holds a capability token: the view record stores the invitation's public slug and
the guest's id, the audit trail stores route patterns, and request logs redact token paths
(`backend/src/common/redact-url.ts:16-26`). The client has no analytics at all. Request logs and
sessions do keep IP addresses and browser names (F-29).

## 9. What wasn't verified, and why

- **Real phones.** Chrome's phone emulation and Playwright's WebKit stood in. Safari itself, a real on-screen keyboard, a real camera at the door and "Add to calendar" opening on iOS and Android were not run.
- **Screen readers.** VoiceOver and TalkBack were not run. Names, roles, live regions and focus moves were read from the accessibility tree instead.
- **In-app browsers** of mail apps, Telegram, WhatsApp and Instagram, and a messenger's rendered link preview. Only the tags were read.
- **A real bank.** Only the development stack's fake bank, which returns at once; a bank's own page and its Back behaviour were not seen.
- **Mail delivery.** No sending domain exists, so spam placement could not be tested.
- **Production.** Caddy, compression, TLS and the container image were not run. The slow-3G figures are from the Node server without compression.
- **The host's journey in Armenian, Russian and French** was probed screen by screen, not driven. Guest and buyer were driven in all four.
- **Checkout by keyboard alone.** The script could not operate the native menu on macOS; the control is a native `select`, so no defect is claimed.
- **Contrast in every state.** Sampled on eleven controls; axe covered the rest at rest. Hover and disabled states across the app were not all measured.
- **Each of the 194 provisional defaults.** Only those a finding rests on were judged: PD-9, PD-21, PD-40, PD-94, PD-127, PD-152, PD-156, PD-180, PD-181, PD-191, PD-194. PD-152 and PD-191 are where a default fell short (F-07, F-12).
- **The data-request form** was rendered and checked by axe in four languages, not submitted. Handling a request as staff was not run.
- **Refunds and cancelling an order as a host,** beyond the suite's own coverage.
- **Exports and billing on a desktop** were judged from the suite's runs and the screen probe; no export file was opened in a spreadsheet or printed.
- **Staff screens, the gallery, signatures and template authoring,** beyond the screen probe.
- **F-29 and F-41** come from reading the code and were not run.

## 10. Questions only the product owner can answer

1. **Is French a launch language?** C-23 ships the interface, but guests get Armenian mail (F-02) and support does not answer in French (C-54).
2. **What language should mail fall back to** when a guest's or host's language has no copy: the event's default, or English?
3. **Who is the seller of a ticket,** Aveline or the host? How and when is the host paid, what does Aveline keep, and what refund rule does a buyer read before paying (F-24, F-37)?
4. **May pilot hosts set paid ticket prices at all** while payments are off (F-09)?
5. **Should public events and the price list be found by search engines** (F-26)? Today none is.
6. **What makes the pilot a success,** in numbers, and who reads them (F-27)?
7. **Is a reply-to address the host's or Aveline's** (F-10)? Hosts' addresses would then be shown to guests.
8. **Does the pilot need SMS?** Guests with only a phone number are unreachable (GL #12b).
9. **Who verifies a data requester and presses "fulfil"** during the pilot, and within what time (C-53)?
10. **Is a new event's default language always Armenian,** even for a host using the English interface? The new-event form starts that way.
11. **Will the designer review before the pilot,** or is a written waiver acceptable for the screens listed in `frontend/docs/design/README.md:139`?
12. **Should the remaining design launch gates be added to `docs/GOING_LIVE.md`** (F-36)? That file is shared, so this audit did not edit it.
13. **What document does a paying host get,** and is it a tax document (F-38)?

## 11. What the audit left behind

- This file.
- Screenshots and Playwright output in the ignored `frontend/test-results/audit-2026-11-13/` (about 110 MB).
- Test accounts, events, guests and orders in the local development database, all on `@demo.test` addresses.
- Playwright's WebKit build in `~/Library/Caches/ms-playwright`, downloaded with permission.
- `frontend/build/`, rebuilt plainly (ignored).
