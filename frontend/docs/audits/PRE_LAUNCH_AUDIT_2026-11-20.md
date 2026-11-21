# Pre-launch audit, 20 November 2026: build apart from business, legal and configuration

> **Status: findings, with what became of them in §8 (22 November 2026).** Run on 20 November 2026 against `dev` at `84bbbd2`, twenty-two commits after
> the [13 November audit](PRE_LAUNCH_AUDIT_2026-11-13.md). Nothing in the repository was changed apart
> from this file. The local stack was started for the audit and stopped afterwards.
>
> "Pilot" means the first real invitation sent to a real guest on the free pilot (`PILOT_MODE=true`).
> "Paid launch" means the first real charge.

## 1. Verdict

- **Pilot: no-go.** Hosting, configuration, external accounts, legal text and sign-offs are still missing.
  The build also has open items:
  - frontend CI, and a release gate that includes it;
  - Telegram webhook registration;
  - a production restore command;
  - a deploy step that updates mail copy (today, the native readers' corrections would never reach production);
  - a way for a host to hand a phone-only guest their link;
  - account mail that can drain the day's email budget.
- **Paid launch: no-go.** Apart from the bank and the seller decision, the payment code has new defects.
  It never checks the captured amount against the order, an uncertain refund can never be resolved, and
  the bank's order lifetime is still not tied to ours.

What held up when run:
- every production boot refusal;
- every development-only route answering 404 in production;
- every backend unit, integration and e2e test, apart from those stopped by two tooling causes on a Mac (A4-10);
- the client's 4,793 unit tests;
- the client's whole e2e suite on a phone, an iPhone and a desktop: 157 passes and no failures across the pilot and paid runs;
- a Russian and an Armenian host's journey through the screens: no serious axe finding, no overflow at 360 px, no raw keys (§4).

## 2. How findings are sorted

Every finding is in **exactly one** category. Part A changes the repository; Part B does not. When an
item has both a code half and a non-code half, it is split into two IDs that name each other. For example,
legal text for the privacy notice is B3-01, and putting that text in the app is A2-01.

| Part | Code | Category | Means |
|---|---|---|---|
| **A: application build** | A1 | Backend code | `backend/src` must change |
| | A2 | Frontend code | `frontend/src` must change |
| | A3 | API contract and docs drift | A doc, `openapi.json` or a client type disagrees with the code |
| | A4 | Build, release, CI and test tooling | Dockerfiles, compose, workflows, ops scripts, tests and gates |
| **B: not the build** | B1 | Hosting and configuration | A host, DNS, TLS, a secret or env value, a destination, a deployed worker |
| | B2 | External accounts and acceptance | Bank, mail provider, WhatsApp, Telegram, SMS |
| | B3 | Legal and regulatory | Notices, terms, consent, data-subject handling, retention, tax, licences |
| | B4 | Business and product decisions | Seller and payout model, sign-offs, native readers, naming people |

**Blocks** says what a finding stops: **pilot**, **paid** (the paid launch only), **cond.** (only if a
pending decision goes one way) or **no**. **Status:** *new* means no doc lists it. *Listed* names the doc
that does. *F-nn* is the 13 November finding it continues. A finding marked † was checked by the lead
at its file and line. The others come from an agent's report, and at least three of each agent's
findings were spot-checked and held.

## 3. Findings

**104 findings: 70 in Part A (build), 34 in Part B (not the build).**

| | A1 | A2 | A3 | A4 | B1 | B2 | B3 | B4 | All |
|---|---|---|---|---|---|---|---|---|---|
| Findings | 33 | 14 | 10 | 13 | 13 | 5 | 6 | 10 | 104 |
| Block the pilot | 3 | 4 | 0 | 6 | 8 | 2 | 5 | 8 | 36 |
| Block only the paid launch | 8 | 3 | 1 | 0 | 1 | 1 | 1 | 1 | 16 |

Of the 36 that block the pilot, **13 are build work** and **23 are hosting, accounts, legal or decisions**.
Eight more block only if a pending decision goes one way (cond.); 44 block nothing.

### Part A: application build

#### A1 Backend code

| ID | Sev | Finding | Evidence | Status | Blocks |
|---|---|---|---|---|---|
| A1-01 † | High | **Account mail can use up the day's email budget and hold back invitations.** A password reset has no dedupe key and no per-account cap. It is queued at priority 10, ahead of invitations at 0. Production defaults to 1,000 emails a day, and the reset route has only the general 100-a-minute limit per address. One script empties the day's budget in about ten minutes and floods the victim's inbox. Verify-email and organization invites work the same way | `backend/src/infra/auth/account.service.ts:188-205`, `backend/src/modules/communications/message-priority.ts:9`, `backend/src/modules/communications/email-quota.service.ts:34-36`, `backend/src/app.module.ts:57-59` | new (GOING_LIVE:128 covers only setting the budgets) | pilot |
| A1-02 † | High | **An erasure can report done while personal data remains.** The signature files, the audit trail and analytics are cleaned only after the database commits: once, with `allSettled`, and with errors swallowed. The request is already COMPLETED by then, and a retry does nothing. If Mongo or storage is down at that moment, the subject's email stays in the audit trail and their drawn signature stays public at its URL | `backend/src/modules/privacy/privacy.service.ts:338-346`, `backend/src/infra/audit/audit.service.ts:90-93`; untested (`backend/test/integration/privacy-erasure.int-spec.ts:41-45` mocks success) | new | pilot |
| A1-03 | High | No staff read of the pilot's counts. PD-205 (provisional) wants it before the pilot. Links A2-04 | `backend/src/modules/staff/staff.controller.ts:14` | listed FR-159; F-27 | pilot (PD-205) |
| A1-04 † | Medium | Resetting the password does not end the sign-in wait, yet `docs/API.md:189-190` promises it does (A3-06) | `backend/src/infra/auth/account.service.ts:210-228`; `LoginAttempts` is used only in `auth.service.ts` | listed FR-160; F-29 | no |
| A1-05 † | Medium | **The sign-in lockout can be raced.** It reads the failure count, runs bcrypt, and only then increments. Parallel requests all pass the check, so N addresses get about 10×N guesses per window instead of 10 | `backend/src/infra/auth/login-attempts.ts:23-34`, `backend/src/infra/auth/auth.service.ts:55-66` | new | no |
| A1-06 † | Medium | **A database read is an account takeover.** Reset, verification and invite tokens are hashed (`account.service.ts:38-41` says why), but each message keeps the full link in plain text in `messages.body`. A leaked database or backup gives working reset links and pending owner invites. `ticket_orders.accessToken` is also plain text | `backend/src/modules/communications/communications.service.ts:611`, `backend/prisma/schema.prisma:1316` | new | no |
| A1-07 † | Medium | Deleting an event removes the row first, then the files with `Promise.all`. If storage fails, the host gets a 500 for a delete that already happened, and the files are orphaned | `backend/src/modules/events/events.service.ts:319-320` | new | no |
| A1-08 † | Medium | Export cleanup re-deletes every old tombstone each minute, forever, because the `cleanupAfter` branch has no `deletedAt: null`. Past roughly 1,500 artifacts the worker runs flat out, and erasure-forced cleanups queue behind them. Private media does the same hourly | `backend/src/modules/exports/export-runner.ts:96-111`, `backend/src/modules/guest-contributions/private-media-runner.ts:103-110` | new | no |
| A1-09 † | Medium | `JWT_SECRET` is checked for presence only, so `x` boots production. `EMAIL_FEEDBACK_SECRET` already requires 32 characters | `backend/src/common/env.validation.ts:28,49`, `backend/src/infra/auth/jwt-secret.ts:10-12` | new | no |
| A1-10 | Medium | Reminders, "details changed" and thank-yous enqueue one household at a time. That is about 1,200 sequential round trips for 400 households, inside the request and in the hourly sweep. B91 removed the same pattern from sending | `backend/src/modules/invitations/sending/reminder.service.ts:308-319` | new | no |
| A1-11 | Medium | Sign-up sends no address-confirmation mail; the client already says one was sent | `backend/src/infra/auth/account.service.ts:143-156` | listed FR-155; F-12 | no |
| A1-12 | Medium | Refusals without a stable code. The client recognises about 40 of them by their English sentence, in 8 files. Undoing a check-in and "sold out" have no code at all | `backend/src/modules/guests/admission.ts:51,54,56`, `backend/src/modules/ticketing/ticket-inventory.service.ts:166`; client `frontend/src/features/door/refusals.ts:183-198` | listed FR-20/28/32/58/63/137 | no |
| A1-13 | Medium | Artwork still defaults to the token-bearing path | `backend/src/modules/invitations/invitations.controller.ts:46,55` | listed FR-115, GOING_LIVE:54 | no |
| A1-14 | Low | A password reset for an unknown address returns faster than one for a registered address, which tells which addresses have accounts. Register and login were already made equal-time | `backend/src/infra/auth/account.service.ts:189-202` | new | no |
| A1-15 | Low | The public `/health/ready` returns each dependency's raw error (internal hosts, ports, bucket endpoint) and probes S3 on every call | `backend/src/infra/health/health.controller.ts:52,65` | new | no |
| A1-16 | Low | The Telegram webhook secret is compared with `!==`; WhatsApp and email feedback use `timingSafeEqual` | `backend/src/modules/communications/telegram-webhook.controller.ts:97` | new | no |
| A1-17 | Low | Every recipient's email address or Telegram chat id is logged at info level, where erasure cannot reach. Retention is B3-05 | `backend/src/modules/communications/channels/smtp.transport.ts:99`, `.../telegram.transport.ts:68`, `backend/src/infra/auth/account.service.ts:110` | new | no |
| A1-18 | Low | The subject-access export matches messages by email only, missing Telegram and WhatsApp. It stops at 500 without saying so, and leaves out sessions (address and browser) | `backend/src/modules/privacy/privacy.service.ts:265-268` | new | no |
| A1-19 † | Low | One-click unsubscribe links are signed with `JWT_SECRET`. Rotating it, which GOING_LIVE #8 requires to be possible, breaks every delivered link, and the guest keeps getting mail | `backend/src/modules/communications/email-unsubscribe.ts:37` | new | no |
| A1-20 | Low | Headcount loads every guest and counts in Node on each dashboard load. The host's order list stops at 500 without paging, so older orders cannot be cancelled | `backend/src/modules/operations/operations.service.ts:64-91`, `backend/src/modules/ticketing/ticket-cancellation.service.ts:160` | new | no |
| A1-21 | Low | Exports write "Arrived" and "Used at" in UTC, against root `CLAUDE.md` §3. This was chosen and documented | `backend/src/modules/exports/export-sheets.ts:83,225`; `backend/docs/EXPORT_RENDERERS.md:25-26` | listed (as a choice) | no |
| A1-22 | cond. | No terms-accepted field on the user, needed if B3-02 decides consent at registration | `backend/prisma/schema.prisma` (User) | listed GOING_LIVE 13d | cond. |
| A1-23 | cond. | No SMS adapter; the registry is empty. Needed only if PD-206 (no SMS in the pilot) is overturned | `backend/src/modules/communications/channels/transport-registry.ts:22` | listed GOING_LIVE 12b | cond. |
| A1-24 † | Blocker | **The bank's order lifetime is not tied to ours** (GOING_LIVE 4c). We expire after an hour, but the bank is not told. EXPIRED is final, so a late capture issues no tickets and is never refunded. A retried invoice opens a second payment: two charges for one invoice | `backend/src/modules/payments/payments.service.ts:28,189`; `providers/arca.gateway.ts:42-49`; `providers/ameriabank.gateway.ts:43-53` | listed GOING_LIVE:73 | paid |
| A1-25 | Blocker | Ameriabank's `OrderID` is sent as our alphanumeric order number. The adapter's own comment says the bank accepts numbers only. Confirming it is B2-05 | `backend/src/modules/payments/providers/ameriabank.gateway.ts:26-27,47`; `payments.service.ts:90` | listed GOING_LIVE:72 | paid |
| A1-26 † | High | **The captured amount is never compared with the order.** `statusFor` discards the bank's `amountMinor`. If ArCa reads AMD in luma (B2-05), a 25,000 order captured as 250 is recorded paid in full, and tickets are issued | `backend/src/modules/payments/payments.service.ts:191-199,564-585`; `providers/payment-provider.ts:33-34` | new | paid |
| A1-27 † | High | **A refund with an unknown outcome stays PENDING forever.** `docs/PAYMENTS.md:167-172` says staff confirm it with the bank, but no code does. The order keeps `cancellationStartedAt`, so the door refuses its tickets and the buyer is never told. A retried cancel polls for 17 s and then answers PAID | `backend/src/modules/payments/payments.service.ts:367-377` (the only COMPLETED write is `:294`); `backend/src/modules/guests/admission.ts:77`; `backend/src/modules/ticketing/ticket-notifier.service.ts:121-123` | new | paid |
| A1-28 | High | The bank's responses are stored verbatim in `payment_events.payload`. Their published shapes carry the cardholder name, masked card, expiry and payer IP. Erasure and the subject export never touch them | `backend/src/modules/payments/payments.service.ts:198,302`; `backend/src/modules/privacy/erasure.ts` | new | paid |
| A1-29 | Medium | Anyone can call the public confirm on a partly refunded payment. If the bank answers "refunded", the whole amount is booked as refunded and further refunds are refused | `backend/src/modules/payments/payments.service.ts:189`; `payment-status.ts:56`; `providers/card-order-status.ts:16` | new | paid |
| A1-30 | Low | More than 100 lapsed paid holds in one run: some expire without the bank being asked, so a buyer who paid gets a refund instead of tickets. Ameriabank receives `hy` where its default is `am` | `backend/src/modules/ticketing/ticketing.service.ts:255-259`, `ticket-fulfilment.service.ts:120-125`; `providers/ameriabank.gateway.ts:60-63` | new | paid |
| A1-31 | Blocker | No receipt email after a plan payment, and an invoice's tax is always 0. Payouts to hosts are not modelled. Each waits on B3-06 and B4-10 | `backend/src/seed/message-copy.ts:21-174`; `backend/src/modules/billing/subscriptions.service.ts:542`; `backend/prisma/schema.prisma` | listed GOING_LIVE 5b, 5c, §2 | paid |
| A1-32 † | Medium | **Why a guest can't be reached is an English sentence, and it misnames a phone number.** On Russian and Armenian screens, a phone-only guest's reason reads "We hold only a whatsapp address, and that channel is not configured". These are exactly the guests PD-206 leaves to the host (A2-02). The reasons have no stable code, so the client cannot translate them | `backend/src/modules/invitations/sending/channel-preference.ts:110-126`; seen on the ru guest list and sending page at 360 and 1280 px | English sentences listed (F-19); this wording is new | no |
| A1-33 | Low | Mail declares no language: no `Content-Language` header, and the HTML part is a bare `<div>` with no `lang`. Screen readers and mail clients' translation offers guess | seen on all 9 messages in the journeys | new | no |

#### A2 Frontend code

| ID | Sev | Finding | Evidence | Status | Blocks |
|---|---|---|---|---|---|
| A2-01 | Blocker | The privacy notice is a marked placeholder and says nothing of browser storage. The text comes from B3-01 | `frontend/src/features/privacy-request/components/privacy-notice-page.tsx:15,30` | listed GOING_LIVE:58; F-03, F-39 | pilot |
| A2-02 † | High | **A host has no way to hand a phone-only guest their link,** yet PD-206 ("no SMS in the pilot") relies on exactly that. The API already returns the token to owners and coordinators; the client's type says "Never read" | `frontend/src/features/guests/types.ts:135`; `docs/API.md:1698-1703`; `frontend/docs/design/DESIGN_DECISIONS.md:1042` | gap listed in ARCHITECTURE:1122; the contradiction with PD-206 is new | pilot |
| A2-03 † | Medium | **Back after paying can still place a second order.** If the held order cannot be read (offline, 429, 5xx), the page falls back to "no order" and shows the live form. The idempotency key was cleared on success. In the pilot that duplicates a free order; on a paid launch it is F-07's double charge | `frontend/src/features/checkout/components/held-order.tsx:49-53`; `frontend/src/features/checkout/components/use-checkout.ts:72` | new (F-07 continued) | no; paid |
| A2-04 | High | No pilot-counts page for staff; it waits on A1-03 | none | listed ARCHITECTURE:1008; F-27 | pilot (PD-205) |
| A2-05 | High | The renderer draws only its own layouts and the bordeaux palette (PD-21), while hosts can choose others. Waits on B4-03 | `frontend/src/features/invitation-renderer/schemas.test.ts:108` | listed GOING_LIVE:56 | pilot |
| A2-06 | Medium | The frontend parts of the design review's P1 and P2 fixes (#2, 3, 7, 9, 15) are not started | `frontend/docs/design/DESIGN_REVIEW.md:160-173` | listed design README:146 | no |
| A2-07 † | Low | After a 409 on a role change, Save is enabled again before the page has re-read the members. A quick second press resends the old revision and gets a second refusal. The server refuses it, so nothing is corrupted. Found when `organization.test.tsx:460` failed under load | `frontend/src/features/organization/components/organization-page.tsx:31-35`, `member-dialogs.tsx:46-70` | new | no |
| A2-08 | Low | Raw `bg-white` instead of a token | `frontend/src/features/agreements/components/drawn-signature.tsx:44`, `frontend/src/features/guest-reply/components/saved-reply.tsx:53` | new (F-34 continued) | no |
| A2-09 | Low | No default share image; the seat map doesn't show taken seats | | listed F-26, FR-158 | no |
| A2-10 | Low | Hardening: the vendor brief renders `venue.mapUrl` without `safeExternalUrl`. The backend allows only http and https, and the CSP blocks `javascript:`, so it is not exploitable today | `frontend/src/features/vendor-brief/components/brief-page.tsx:53` | new | no |
| A2-11 | cond. | A terms page, linked from sign-up, checkout and the mail footer, if B3-02 says so | `frontend/src/routes.ts` (no route) | listed GOING_LIVE 13d; F-03 | cond. |
| A2-12 | Blocker | Checkout names no seller, refund rule or terms (needs B4-10, B3-06), and an invoice cannot be printed or downloaded | `frontend/src/features/checkout/components/place-order.tsx:42-61`; `frontend/src/features/billing/components/invoice-list.tsx:71-81` | listed F-24, F-38; GOING_LIVE 5c | paid |
| A2-13 | Medium | Plan names and features are English only, and "99 languages" is shown for no limit. Needs plan copy per language from the backend | `frontend/src/features/billing/components/plan-list.tsx:13-14,58` | listed FR-110; F-25 | paid |
| A2-14 | Low | The raw zone id "Asia/Yerevan" appears inside Russian and Armenian sentences (the new-event zone menu, the venue's arrival help). The "English" checkbox on a ru or hy screen has no `lang="en"` (WCAG 3.1.2), which axe does not catch | seen on the ru and hy new-event and venue screens at 360 and 1280 px | new | no |

#### A3 API contract and docs drift

| ID | Sev | Finding | Evidence | Status | Blocks |
|---|---|---|---|---|---|
| A3-01 † | High | **`openapi.json` drops `payment` from the order response.** `createOrder` has no return type, so the branch with `payment` is lost. `docs/API.md:1202` documents the field, and the client reads it untyped without recording that under FR-149. The fix breaks nothing for the client | `backend/openapi.json` `TicketingController_createOrderResponse`; `backend/src/modules/ticketing/ticketing.service.ts:71,114,402`; `frontend/src/features/checkout/api.ts:20-28` | new | paid |
| A3-02 † | Medium | **`docs/GOING_LIVE.md` contradicts the code in six places.** `:59` lists F-07, F-08 and F-09 as open, with F-07's old wording. `:102` says the staff screen isn't built, but `frontend/src/routes.ts:66-71` has it. `:85` says French has no mail copy, but `message-copy.ts:16` has some. `:97` calls the restore tooling complete, but A4-04 is missing. `:129` says the client's job integration remains. `:151` gives the test count as 1,170+ | as cited | new | no |
| A3-03 | Medium | `docs/CLIENT_BACKEND_REQUESTS.md` has no FR-155 to FR-161, three of them High. It still shows FR-64 and FR-109 as "Audit and implement", and FR-62, FR-76 and FR-79 as awaiting adoption: all five are built and adopted | `docs/CLIENT_BACKEND_REQUESTS.md:94,96,108,111,141` | new | no |
| A3-04 | Medium | Four query parameters the code reads are missing from `openapi.json`: `privacy/requests?status`, `vendors?category`, `venue-profiles?city`, `design-templates?cursor`. The data-requests summary says "Open requests" but returns every request | `backend/src/modules/privacy/privacy.controller.ts:19-23,47`; `vendors.controller.ts:19`; `design.controller.ts:24`; `template-authoring.controller.ts:9` | new | no |
| A3-05 | Medium | The design launch gates (native readers, designer, palette, review fixes) are not in `docs/GOING_LIVE.md`; only the photographs are | `frontend/docs/design/README.md:139-149`; `docs/GOING_LIVE.md:60` | listed F-36, Q12 | no |
| A3-06 | Medium | `docs/API.md:189-190` promises that a reset lets the owner back in; it doesn't (A1-04) | | listed FR-160 | no |
| A3-07 | Low | "Not yet built" entries for things that are built: client signature, moderation and preview (`docs/INVITATION_DESIGN.md:247-249`), client job integration (`docs/VENUES_AND_SEATING.md:226`, `docs/API.md:4090`), client export screens (`backend/docs/EXPORT_WORKER.md:89`, `EXPORT_RENDERERS.md:105`), session retention (`backend/docs/DATA_MODEL.md:325`). "Separate branch" in `docs/BACKLOG.md:29,34,103` and `docs/TODO.md:3,45-47`; French in TODO | as cited | new (TODO part listed F-36) | no |
| A3-08 | Low | `docs/API.md` slips. `:152-160` says every list is an offset envelope, but 28 are bare arrays. The money example at `:147-150` uses `Number()`. `GET /events/:eventId/listing` is undocumented. The `devLink` list at `:4029` is incomplete. `PRODUCT_SPEC.md:304` cites §12 for prices that are in §14 | as cited | partly listed BACKLOG:221-222 | no |
| A3-09 | Low | Deployment docs. `DEPLOYMENT.md:51-54` leaves out `replyTo`, which init requires. `:222` claims a Garage version check that the script does not make. `RELEASES.md:92` and `release.yml:14-29` call the support inputs optional, but the Dockerfile refuses to build without one. `STORAGE_DRIVER` and `PUBLIC_BASE_URL` are in the templates but nothing reads them, while `MAIL_REPLY_TO` is missing from `backend/.env.example`, so development mail has no Reply-To to check. `frontend/Dockerfile:2-3` says "Not built by anyone yet". `backend/docs/LOCAL_CI.md:100` is out of date | as cited | new | no |
| A3-10 | Low | `openapi.json` is looser than `docs/API.md` in four places, for example the seating job's `result` | | listed FR-149 | no |

#### A4 Build, release, CI and test tooling

| ID | Sev | Finding | Evidence | Status | Blocks |
|---|---|---|---|---|---|
| A4-01 † | Blocker | **No frontend check gates a release.** `release.yml` needs only `backend.yml` before it builds and publishes the web image. `frontend.yml` runs only by hand, and `ci:local` checks the backend only. A web image no frontend test has run on can be attested and deployed | `.github/workflows/release.yml:39-45,82-87`; `.github/workflows/frontend.yml:1-14`; `backend/scripts/ci-job.mjs:11-28` | partly listed GOING_LIVE:57; the release gate is new | pilot |
| A4-02 | Blocker | The client's e2e suite has never run against staging. On a production-like stack the billing F-09 check skips, the mail tests skip without Mailpit, and any outbox error reads as "not development" and skips (`frontend/test/e2e/support/stack.ts:21`): 32 of 153 runs skip there | `frontend/test/e2e/billing.spec.ts:34`, `sending.spec.ts:12`, `account.spec.ts:47` | listed GOING_LIVE:57 (the skip gaps are new) | pilot |
| A4-03 † | High | Nothing registers the Telegram webhook (`setWebhook`), so the bot never receives updates. This becomes a pilot blocker if Telegram is in the pilot (B4-09) | `git grep setWebhook` finds only the doc | listed GOING_LIVE 7c | cond. |
| A4-04 † | High | **There is no restore command for production.** `ops.mjs` has backup and backup-check but no fetch or restore. The `backup` service mounts Garage read-only, and `restore-recovery.sh` needs fresh, empty Garage volumes that the fixed volume names prevent. A restore means assembling `docker run` lines from the rehearsal script under pressure | `backend/scripts/ops.mjs:18`; `backend/docker-compose.prod.yml:317-318`; `backend/scripts/restore-recovery.sh:27-29` | new (GOING_LIVE #10 says it is complete) | pilot |
| A4-05 † | High | Local `ops apply` (the QA install) cannot build the web image: compose passes no `VITE_SUPPORT_*`, and the Dockerfile refuses to build without one | `backend/docker-compose.prod.yml:52-57`; `frontend/Dockerfile:22-24` | listed FR-161 | pilot |
| A4-06 | High | The load script calls the API directly, never through Caddy and the renderer | | listed GOING_LIVE 13c | pilot |
| A4-07 | Medium | **Backups will outgrow their timeout.** Each night `restic check --read-data` downloads the whole repository, and `forget` never prunes. Once a run passes 30 minutes, no success marker is written: the backup fails nightly, and deploys of a populated install are blocked | `backend/scripts/backup-upload.sh:26,32`; `backend/scripts/ops/jobs.mjs:9`; `backend/scripts/ops/deploy.mjs:69` | new | no |
| A4-08 | Medium | Every release run rebuilds the API and backup images, so the digest deployed to production is never the one staging tested | `.github/workflows/release.yml:80-81`; `backend/docs/RELEASES.md:99-101` | new | no |
| A4-09 | Medium | Docker does not restart an unhealthy container, and nothing watches health or alerts. A hung export, seating or media worker stays down silently | `backend/docker-compose.prod.yml:113-199`; `backend/docs/EXPORT_WORKER.md:51-52` | new | no |
| A4-10 † | Medium | **The backend suites are red on a developer's Mac for tooling reasons:**<br>• The journal tests spawn `flock`, a Linux tool, and the backup script then misreads its absence as "Another capture is running". On macOS that fails 10 unit, 2 backup, 48 integration and 35 e2e tests.<br>• The two suites that boot the real factory in production never set `DATABASE_URL`. Prisma then loads `backend/.env`, so the production-configured app, crons included, runs against the developer's database while the fixtures write to the test database. That gives 3 false failures; with the variable set, 15 of 15 pass.<br>• The client's tests that use the 1-second `findBy` fail under load (`asyncUtilTimeout` is unset).<br>• Playwright reuses whatever answers on port 5173. On this machine another project's dev server held the port, and the whole suite ran against it: 59 fast failures, none of them Aveline's. | `backend/src/modules/sales/enquiry-journal.ts:44`; `backend/scripts/capture-backup.sh:9`; `backend/test/e2e/areas/platform-resilience-production.e2e-spec.ts:23-55`; `.github/workflows/backend.yml:50`; `frontend/src/features/guests/guests.test.tsx:665`, `seating/seating.test.tsx:421`, `organization/organization.test.tsx:456-460`; `frontend/playwright.config.ts:65`, `frontend/test/e2e/support/env.ts:6` | new | no |
| A4-11 | Medium | Untested launch paths and weak tests:<br>• Untested: whether each sender passes the event's language (C-59), and failures during erasure or event deletion.<br>• Weak assertions: 34 bare `rejects.toThrow()`, and `ticket-inventory.int-spec.ts:87` passes even when every reservation is refused.<br>• Interference: 66 of 88 e2e suites leave the per-minute crons running, hidden by a TRUNCATE retry.<br>• Races against real sleeps, and route-guard checks that skip `events/:id`. | `backend/src/modules/communications/mail-locale.spec.ts:11`; `backend/test/setup/test-database.ts:55-63`; `backend/src/infra/auth/critique-route-guards.coverage.spec.ts:93` | new | no |
| A4-12 | Low | Operations housekeeping:<br>• `backup-check` takes the deployment lock, so alerts fire falsely during backups and deploys.<br>• The deploy check skips the media origin.<br>• Restic's `--host` is hard-coded.<br>• `SENTRY_RELEASE` is never set.<br>• The renderer reports errors nowhere (C-27 is open).<br>• Node, Postgres, Redis, Garage and the workflow actions are pinned by tag, not digest or SHA.<br>• Stale `systemd/aveline-backup*.service` and `restore.sh`.<br>• Mongo has no memory cap.<br>• Bank keys are missing from `.env.production.example`, and `ops configure` refuses them (paid).<br>• No development route makes staff accounts, so staff screens have no e2e (FR-157). | `backend/scripts/ops.mjs:43`; `ops/deploy.mjs:72-83`; `backup-upload.sh:25`; `backend/src/infra/observability/sentry.ts:21`; `backend/docker-compose.prod.yml:260-271` | new (FR-157 listed) | no |
| A4-13 † | High | **A deploy never updates mail copy that already exists.** The release seed calls `syncPlatformCopy(prisma, 'fill')`: it adds missing templates and leaves existing ones alone. Only the development seed refreshes, and no ops command or deployment doc covers it. So the copy from the first deploy stays: the native readers' corrections (B4-01), the 14 November Russian copy and the "when and where" lines would never reach a database seeded earlier.<br>Seen on this stack: after today's `seed:production`, the platform copy was still dated 12 November (en and hy only). A Russian guest got an English invitation with no date or venue, and a Russian host an English reset mail | `backend/src/seed-production.ts:231-237`; `backend/src/seed/message-copy-sync.ts:16,28`; `backend/prisma/seed.ts:347` | new | pilot |

### Part B: not the build

#### B1 Hosting and configuration

| ID | Sev | Finding | Evidence | Status | Blocks |
|---|---|---|---|---|---|
| B1-01 | Blocker | Set up the host, app and media DNS, TLS, the GitHub environments, reviewers and SSH, then deploy an attested staging release (FR-11) | `backend/docs/RELEASES.md:40-61`; `backend/.env.production.example:14-25` | listed GOING_LIVE #11, :51; F-01 | pilot |
| B1-02 | Blocker | Production values: `JWT_SECRET` (generate at least 32 characters; see A1-09), `CORS_ORIGINS`, `PUBLIC_APP_URL`, `PILOT_MODE=true`, `MAIL_REPLY_TO`, `SMTP_HOST` and `MAIL_FROM`. Each guard was proven by booting without it (§4) | `backend/src/common/env.validation.ts:28` | listed GOING_LIVE #8-9b | pilot |
| B1-03 | Blocker | Web build values: at least one support contact, `VITE_SITE_URL`, and the real `VITE_PUBLIC_ORIGIN` and `VITE_MEDIA_BASE_URL`. A compose build without them falls back to `127.0.0.1` and quietly breaks pictures, songs and canonical links | `frontend/Dockerfile:16-24`; `backend/docker-compose.prod.yml:55-56` | listed GOING_LIVE:58; the loopback fallback is new | pilot |
| B1-04 | Blocker | The off-host backup destination, the Restic password and credentials, the installed timers, the `OnFailure=` alert receiver, and a verified remote restore | `backend/scripts/ops/jobs.mjs:9` | listed GOING_LIVE #10 | pilot |
| B1-05 | Blocker | Deploy and watch the workers. Check that the private bucket refuses anonymous reads | `backend/docker-compose.prod.yml:113-199` | listed GOING_LIVE:172-198 | pilot |
| B1-06 | Blocker | `SENTRY_DSN` and an alert destination, without which overdue data requests alert no one | `backend/.env.production.example:105` | listed GOING_LIVE #17, #13 | pilot |
| B1-07 | High | An external uptime monitor for the app, `/api/v1/health/ready` and the media host | `backend/docs/DEPLOYMENT.md:27-28` | new | pilot |
| B1-08 | High | On the real host: performance and load through TLS, Caddy and the renderer; the legacy invitation-lifetime review; the expiry sweep | | listed GOING_LIVE:31-35, 13c, :200-214 | pilot |
| B1-09 | Medium | Request logs: Caddy keeps visitor addresses, and compose rotates by size, not age. Configure them once B3-05 sets the period | `backend/Caddyfile:5-11`; `backend/docker-compose.prod.yml:17-21` | listed GOING_LIVE 13e | no |
| B1-10 | Medium | Set sender budgets to the provider's limits, and run the migrations against real data volume | | listed GOING_LIVE:118,128 | no |
| B1-11 | Low | Accepted for the pilot: single node, no zero-downtime deploy, no CDN, rate limits counted per instance, no log shipping | | listed GOING_LIVE #14-15, §2 | no |
| B1-12 | cond. | The Telegram bot token and webhook secret, if Telegram is in the pilot (B4-09) | `backend/.env.production.example:77-79` | listed GOING_LIVE 7b, 7c | cond. |
| B1-13 | Blocker | Set the banks' production endpoints. `AMERIA_BASE_URL` and `INECO_BASE_URL` default to the test hosts and are not in the production template | `backend/src/modules/payments/payments.module.ts:29,39` | new | paid |

#### B2 External accounts and third-party acceptance

| ID | Sev | Finding | Status | Blocks |
|---|---|---|---|---|
| B2-01 | Blocker | An SMTP provider and sending domain with SPF, DKIM and DMARC, plus proof a real message lands outside spam | listed GOING_LIVE #6, #7; F-01 | pilot |
| B2-02 | High | WhatsApp: account, number, templates approved in three languages, consent, and receipts | listed GOING_LIVE #12; TODO:115-130 | pilot |
| B2-03 | cond. | A Telegram staging bot rehearsal of the opt-in, after A4-03 | listed GOING_LIVE 7b | cond. |
| B2-04 | cond. | An SMS provider that reaches Armenian numbers, if PD-206 is overturned | listed GOING_LIVE 12b | cond. |
| B2-05 | Blocker | A merchant account, a sandbox run, Ameriabank certification (five test payments), and deposit capture verified. Also the bank's own specification for the `OrderID` type, AMD units and status codes, and one real refund | listed GOING_LIVE #1-5, 4b | paid |

#### B3 Legal and regulatory

| ID | Sev | Finding | Status | Blocks |
|---|---|---|---|---|
| B3-01 | Blocker | The privacy notice and the data-request wording, drafted and read by a lawyer, including the browser storage the app uses. A2-01 puts the text in the app | listed GOING_LIVE:58; C-50; F-03, F-39 | pilot |
| B3-02 | Blocker | Decide whether the pilot needs terms of service and consent recorded at registration (then A1-22, A2-11) | listed GOING_LIVE 13d | pilot |
| B3-03 | Blocker | Who verifies a data requester, and within what time (PD-207 is provisional) | listed GOING_LIVE #13; C-53 | pilot |
| B3-04 | Blocker | The placeholder photographs are third-party and not licensed to Aveline | listed GOING_LIVE:60; C-34 | pilot |
| B3-05 | High | A retention period for request and application logs, which hold addresses, browsers and recipients (see A1-17) | listed GOING_LIVE 13e | pilot |
| B3-06 | Blocker | Whether an invoice is a tax document; the seller and refund terms a buyer reads; the basis for keeping card details from bank responses (see A1-28) | listed GOING_LIVE 5b, 5c; F-24; PD-209 | paid |

#### B4 Business and product decisions

| ID | Sev | Finding | Status | Blocks |
|---|---|---|---|---|
| B4-01 | Blocker | Native readers check the Armenian and Russian interface and mail copy (PD-9). The journeys found two candidates. The Armenian invitation subject hyphenates the case ending onto the hosts' names ("Հրավեր Աննա և Դավիթ-ից"). The Armenian import help leaves "CSV UTF-8 (comma delimited)" in English, where Russian translates it | listed GOING_LIVE 6b; design README:139 | pilot |
| B4-02 | Blocker | Designer sign-off, or a waiver signed by the product owner (PD-208 is Arthur's provisional answer, not a waiver) | listed design README:140,149 | pilot |
| B4-03 | Blocker | Replace the palette stand-in or accept it in writing, and decide which layouts, fonts and palettes the renderer supports (FR-42, FR-9) | listed GOING_LIVE:56; PD-21 | pilot |
| B4-04 | Blocker | Which support contacts are published, and who reads the support mailbox | listed GOING_LIVE 6c; C-54, C-62 | pilot |
| B4-05 | Blocker | Name the first admin and support staff | listed GOING_LIVE 13b | pilot |
| B4-06 | Blocker | On staging, skip the paid journeys or pay at the bank's test environment | listed GOING_LIVE:57 | pilot |
| B4-07 | Blocker | Go/no-go acceptance: the three-language walkthrough, the door on real phones, gallery and agreements, prints and spreadsheets, RPO and RTO, the pilot date | listed GOING_LIVE:26,53,186; TODO:161-195 | pilot |
| B4-08 | High | The product owner confirms PD-203 to PD-212, above all PD-206 (no SMS), which today leaves phone-only guests with no way in (A2-02) | listed audit 13 Nov §12 | pilot |
| B4-09 | cond. | Is Telegram in the pilot? That decides A4-03, B1-12 and B2-03 | new | cond. |
| B4-10 | Blocker | Choose the bank. Decide the seller, Aveline's fee, the payout schedule, the refund rule and prices | listed GOING_LIVE 5b, §4; C-60 | paid |

## 4. What was run

Run on a MacBook (Apple silicon, macOS), Node 24.19, with the stores in colima. Commands ran from
`backend/` and `frontend/`. Logs were kept in the session's scratchpad, not the repository.

| Check | Scope | Result |
|---|---|---|
| Backend static gates | `npm run lint`, `docs:check`, `openapi:check`, `build` | All pass; `openapi.json` matches the code (227 paths) |
| Backend unit | `npm run test:unit` | 1,768 of 1,778 pass. All 10 failures are `spawn flock ENOENT` (A4-10) |
| Backend scripts | `test:pilot`, `test:backup` | Pilot 10 of 10. Backup: 2 failures, both from the missing `flock` |
| Backend integration | `npm run test:int` against Postgres, Redis, Mongo, Garage and Mailpit | 903 of 952 pass. 48 failures are `flock`. One export snapshot was left QUEUED under load; that suite passes 36 of 36 alone |
| Backend e2e | `npm run test:e2e` | The first run is void: the Mac slept from 16:09 to 17:47, the stores dropped, and Jest ran out of memory. The rerun under `caffeinate` passed 1,441 of 1,479. 35 failures are `flock`, and 3 are the `DATABASE_URL` issue in A4-10; with it set, those suites pass 15 of 15 |
| Frontend gates | `npm run verify` and `check:boundaries` | Format, types, lint, build, budgets and boundaries all pass. Ticket pages are at 196 of 200 KB; the door is at 328 of 340 KB |
| Frontend unit | Vitest | 4,793 of 4,796 pass. The 3 that failed under load pass 167 of 167 alone, twice (A4-10). One of them showed the race in A2-07 |
| Production boot | `node dist/main.js` with `NODE_ENV=production`, one required value left empty each time | Each of `JWT_SECRET`, `CORS_ORIGINS`, `PUBLIC_APP_URL`, `PILOT_MODE`, `MAIL_REPLY_TO` and `SMTP_HOST` stops the start with a named error |
| Production routes | The same build, fully configured, with `PILOT_MODE=true` | `development/outbox/send`, `development/plans/:key/offer`, `payments/:n/fake-bank` and `/api/docs` answer 404. `payment-options` says payments are unavailable. A password reset returns `{"sent":true}` with no link |
| Client e2e, pilot | `frontend/test/e2e`, all 13 specs, on a 360 px phone (Chrome), a 390 px iPhone (WebKit) and 1280 px Chrome. Real API with `PILOT_MODE=true`, plus workers and Mailpit | **130 of 153 pass, 0 fail, 23 skipped.** The skips are the paid journeys, the keyboard reply (desktop only by design) and the offline tickets page (production build only) |
| Client e2e, paid | `tickets.spec.ts` and `billing.spec.ts` on the three projects, payments on through the development fake bank | **27 of 36 pass, 0 fail, 9 skipped** (the pilot-only checks, which passed in the run above, and the offline page) |
| Journeys driven through the screens | One agent with Chrome, against the same pilot-mode stack. A host registered in Russian and in Armenian, set up an organization, created an event, set a venue, published, imported 3 guests (one with a phone only) and sent. Russian at 360 and 1280 px, Armenian at 360 px. Nine messages were read from Mailpit | 57 screens: no serious or critical axe finding, nothing wider than 360 px, no raw translation key. The new-event form starts in the host's language (PD-203). Guest locales are kept or dropped as `docs/API.md:1610` says. F-18 holds. Found A2-02 (confirmed from outside), A4-13, A1-32, A1-33, A2-14 and two B4-01 candidates. Guest mail carries one-click `List-Unsubscribe`. **Cut short:** the API was stopped from outside the audit at about 21:02 and again at 21:10, so the Armenian run at 1280 px, the guest's reply and reload, and the door were not driven. The suite covers the last two in English |
| Code and docs | Seven read-only agents: readiness, backend security, frontend security, contract, backend correctness, tests, release and operations | Every finding marked † was re-read at its line by the lead; at least three of each agent's other findings were spot-checked and held |

Two runs were interrupted and done again; neither interruption is counted as a finding. The API process
was ended by a SIGTERM at 19:40, which the audit did not send, during the paid run; the paid run was
repeated from the start. The first client e2e run was aimed at the wrong server (A4-10).

## 5. The 13 November findings

Every row of that audit's §12 holds in code. Five are only partly done:
- **F-07:** built differently from `docs/GOING_LIVE.md:59`, and A2-03 remains.
- **F-12:** the backend still sends no mail at sign-up (A1-11).
- **F-29:** a reset does not end the wait (A1-04).
- **F-34:** `bg-white` remains in two places (A2-08).
- **F-02/F-10:** they hold, and French copy exists where `docs/GOING_LIVE.md:85` says it doesn't.

Findings that §12 does not mention:
- **F-01, F-03, F-05, F-24, F-27, F-36, F-39:** still open (B1-01, B3-01, B3-02, B4-01 to B4-03, A2-12, A1-03, A3-05, A2-01).
- **F-04:** the code half is done, since the Dockerfile refuses a build with no support contact, but the values are unset (B1-03, B4-04).
- **F-18:** closed. At 360 px in Russian and Armenian, with "More" closed and open, every row action
  on the guest list is at least 44×44 px.

## 6. What wasn't verified, and why

- **Anything deployed.** No host, Caddy, TLS, container image, real bank or real mail delivery exists, so
  every B1 and B2 item is unproven by definition. The production checks above ran the API build directly,
  not the image.
- **The backend on Linux.** The 95 tests that need `flock` did not run here. `backend/docs/LOCAL_CI.md:66`
  says the runner image has it. `npm run ci:local` was not run: it checks the backend only.
- **The offline tickets page (PD-202)** needs a production build behind one origin; both client runs
  skipped it.
- **Real phones, screen readers and in-app browsers**, as on 13 November.
- **Restore, load and long-run behaviour.** The backup rehearsal, the pilot load script and a soak test
  were not run. A4-04, A4-07 and A4-09 come from reading the code.
- **The private-media and template-asset workers** were not started. The gallery, uploads and signatures
  were exercised only as far as the suite goes.
- **Exports opened in a spreadsheet or printed**, and plan payments at a real bank.
- **The paid-launch payment findings** (A1-24 to A1-30) come from reading the code against the banks'
  published integrations. Each needs the bank's own specification (B2-05) to confirm.
- **Mail as a correctly seeded database sends it.** The journeys read copy from a database seeded on
  12 November (A4-13), so they could not check the Russian invitation, its date and venue in the event's
  zone, or Reply-To. `backend/src/seed/message-copy.spec.ts:56-80` proves the repository's copy has
  hy, en and ru for every template.
- **Why the API kept stopping.** It stopped at 19:40, about 21:02 (seen paused) and 21:10. It was not
  sent a signal by the audit; the Mac slept on battery around 21:00, and another project's test runs were
  active at the same time. The cause was not established.

## 7. Not in any shared doc

For Arthur to decide whether to add them to `docs/GOING_LIVE.md`. That file is shared, so the change
needs the backend's review.
- **Pilot:** A1-01, A1-02, A2-02, A4-01 (the release gate), A4-04, A4-13, B1-07.
- **Paid launch:** A1-26, A1-27, A1-28, A1-29, A3-01, B1-13.
- **Doc corrections:** A3-02, A3-03.

## 8. Follow-up

Recorded on 22 November 2026, after the plan of 21 November (the client builds `frontend/` only; the backend's
items are requests).

| Item | What became of it | Where |
|---|---|---|
| A2-02 | Built: "Copy personal link" on a guest's row, only where the token was sent, the invitation is published and the guest wasn't erased; never shown, only copied | Design PD-213; `features/guests` |
| A2-03 | Built: checkout keeps the held-order notice when the order can't be read (no signal, 429, 5xx, any other failure); only a 404 brings the form back. "Try again" keeps the focus | Design PD-214; `features/checkout/components/held-order.tsx` |
| A2-07 | Built: a stale refusal keeps the dialog busy until the page is read again | `ui/app-form/use-dialog-action.ts` |
| A2-08, A2-10 | Built: the two raw colours are tokens; the brief's map link uses `safeExternalUrl` | |
| A2-14 | Built: a city in the page's language in sentences, the zone menu's city beside its IANA name, `lang` on language names | Design PD-215 |
| A3-09 (client part) | The `Dockerfile`'s comment corrected | `frontend/Dockerfile` |
| A4-02, A4-10 (client parts) | Built: only a 404 means "not development"; billing's pilot line checked on any stack; a check that the base URL serves Aveline; a 3 s wait in unit tests; a real-reload test of the guest's reply. The suite on staging waits for B1-01 | `test/e2e/support/`, `test/setup.ts` |
| B3-01 (input to it) | The browser-storage inventory for the lawyer | [BROWSER_STORAGE.md](../BROWSER_STORAGE.md) |
| A1, A3 and A4 backend items | Sent to the backend as FR-162 to FR-198, and §4 rows for the shared docs | [BACKEND_REQUESTS.md](../BACKEND_REQUESTS.md) |
| A4-01 | Waits for a root session on Arthur's go: `.github/` is shared | |
| Everything in Part B | An owner checklist, kept by Arthur | |

The rest of Part A waits on an input: the lawyer's text (A2-01, A2-11), FR-159 (A2-04), the designer (A2-05, A2-06,
A2-09), and the paid launch's decisions (A2-12, A2-13).
