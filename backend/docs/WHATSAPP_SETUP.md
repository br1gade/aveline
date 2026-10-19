# WhatsApp pilot setup and acceptance

Batch I implements the Cloud API status adapter. **No Meta account or test
number exists yet (operator update, 19 October 2026). F21 remains open for real
provider acceptance.** These steps do not create accounts, accept terms, send
messages or incur charges automatically.

## Operator setup

1. Create the business portfolio/account and a Meta app using the WhatsApp use
   case. Complete the verification, business/number registration and billing
   requirements shown for that account. Start with Meta's test sender and an
   explicitly consenting, controlled test recipient. Obtain production access
   before any pilot guest send; test credentials are not production readiness.
2. Grant the appropriate system user access to the account and sender. Current
   Meta docs require `whatsapp_business_messaging` for the `messages` webhook;
   management operations may also need `whatsapp_business_management`. Complete
   any app review/advanced access/live-mode requirements applicable to this app.
   Issue an appropriately scoped server-side access token; record rotation and
   expiry ownership. Never share tokens, app secrets or guest capability links
   in screenshots, tickets or source control.
3. Verify a currently supported Graph API version against Meta's changelog and
   the actual account. Set `WHATSAPP_API_VERSION=vN.0` explicitly. There is no
   silent default or automatic upgrade. Record the selected version and the
   date its support was checked in private release evidence.
4. Register and obtain approval for every used template and locale. Map each
   `MessageTemplate.providerTemplate` and ordered `providerParams` to the actual
   approved template. Verify **en/ru/fr/hy** against Meta's current supported
   language codes and the account's approved versions; a seeded translation
   alone is not proof of provider support. The adapter sends the message locale
   unchanged. If a required locale is unsupported or approval is refused, bring
   that decision back to the product owner before claiming full-scope readiness.
   Record guest consent and follow the applicable messaging policy. A phone
   number in an imported guest list alone is not proof of WhatsApp consent.
5. Configure all six settings in the API's private `.env.production`:

   | Setting | Source/purpose |
   |---|---|
   | `WHATSAPP_ACCOUNT_ID` | Account ID present in the `messages` payload's `entry[].id` (current docs call this the Messaging account ID) |
   | `WHATSAPP_PHONE_NUMBER_ID` | Sender ID from `value.metadata.phone_number_id`, not the phone number itself |
   | `WHATSAPP_ACCESS_TOKEN` | Authorized server-side token for that sender |
   | `WHATSAPP_API_VERSION` | Explicit, operator-verified Graph version |
   | `WHATSAPP_APP_SECRET` | Meta app secret; authenticates exact POST bytes |
   | `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Independently generated 32–256 character token for subscription verification |

   In production, any one configured setting requires all six. Account/sender
   IDs must be decimal; app secret and verification token must be 32–256
   characters. In development, incomplete settings leave the real transport
   disabled. Keep the whole channel unconfigured until setup is ready.
6. Deploy the migration and API behind valid public HTTPS. Set Callback URL to
   `https://<API_DOMAIN>/api/v1/communications/whatsapp-webhook` in App Dashboard
   → WhatsApp → Configuration (or Use cases → Customize → Configuration).
   Supply the verification token and confirm the GET challenge succeeds.
   Subscribe the app to `messages` and the intended account, using the dashboard
   and account subscription flow required by that account. A successful GET
   alone does not prove account-level subscription or actual event delivery.
7. Ensure proxy/WAF rules preserve request bytes and `X-Hub-Signature-256`, allow
   GET/POST, allow bodies up to 3 MiB, and do not decompress/rewrite signed
   bodies. The route rejects compressed requests, malformed JSON, bodies above
   3 MiB and batches above 1,000 statuses/changes. Other API routes retain their
   normal body limit. Standard public request throttling applies; budget for
   Meta traffic and verify legitimate bursts through the deployed edge.

## Real acceptance evidence (launch gate)

Use synthetic event data and controlled recipients; retain redacted results in
the private release record, not raw provider payloads or guest addresses.

- [ ] App/account/sender permissions, production eligibility and template locale
  approval verified; API version and next review date recorded.
- [ ] A real approved template send returns a provider message reference. The
  stored Message has the same account/sender scope; acceptance shows `SENT`.
- [ ] An actual signed callback from Meta reaches the deployed endpoint and
  receives `200 { "accepted": true }` after Postgres acceptance.
- [ ] `whatsapp.receipts` runs every minute, applies delivered/read evidence and
  the host sees it. Read is `DELIVERED` plus `readAt`, never a new status enum.
  Read receipts may be absent; an absent `readAt` is not proof of unreadness.
- [ ] Capture delivered and, when emitted, read outcomes. Exercise a controlled
  provider-supported failure; record its numeric code/classification. Forged,
  duplicate, early, delayed and out-of-order cases also pass local tests.
- [ ] Neither an account/template/billing failure nor ambiguous recipient
  delivery changes creates a global suppression. Acknowledged failures are
  terminal for that send; no automatic resend or paid fallback is triggered.
- [ ] Restart/redeploy and a temporary Redis outage leave accepted receipts in
  Postgres. After recovery the sweep drains pending work. Unknown references
  remain pending for seven days; processed receipts expire after thirty days.
- [ ] Monitor `whatsapp.receipts` check-ins, Postgres failures, oldest pending
  receipt and queue depth. Each sweep takes at most 200 receipts, five
  transactions at once, rotating unknown IDs. Confirm lag is acceptable at the
  actual pilot send rate; tune capacity only after measuring.
- [ ] Verify provider retries on non-200, valid subscription and edge logging
  redaction. No raw bodies, contact numbers, signature headers, verification
  tokens or capability URLs should appear in logs or incident reports.
- [ ] Run frontend host and guest messaging acceptance in all four languages.
  Native email feedback F22 remains explicitly deferred; real email sending
  and sender/domain verification still have their own launch gate.

## Receipt behavior and operational limits

Only signed, configured account/sender `messages.statuses` are normalized.
Incoming chat messages, account-level notifications, media and unknown status
names are ignored; this is not a two-way chat or marketing-preferences adapter.
Delivery/read evidence wins over late sent/failed events. A failure is stored as
`FAILED` with `deliveryFailedAt`, `deliveryErrorCode`, `deliveryFailureKind` and
a generic `failureReason`; raw error descriptions are discarded. Classes are
`CONFIGURATION`, `TRANSIENT`, `AMBIGUOUS`, `UNKNOWN`. No class suppresses a phone.

Synchronous rejection before acceptance uses the existing bounded retry budget,
without global suppression. Error 131049 waits at least 24 hours before another
attempt. Explicit sender-block/marketing-stop errors (130403/131050) stop that
message without globally blacklisting the person. Account/template problems
require operator repair; asynchronous failures require review before resending.

Historical messages without recorded account/sender scope are intentionally not
matched by a bare provider reference. Changing sender configuration must include
an explicit plan for draining/reviewing old pending receipts. Never backfill
scope based on guesses. Provider acceptance lost during a crash can still cause
an at-least-once resend after stranded-send recovery; this batch does not promise
exactly-once external delivery. Meta retries unacknowledged callbacks for up to
seven days; it does not offer historical webhook replay through this adapter.

## Primary references checked 19 October 2026

- [Meta: create a webhook endpoint](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint)
  — verification GET, exact-byte HMAC, 200 acknowledgement, batching/retries.
- [Meta: webhook overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview)
  — permissions, subscription, 3 MB payload size and retry behavior.
- [Meta: messages payloads](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages)
  and [status payloads](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status)
  — account/sender/message identity, timestamps, sent/delivered/read/failed,
  read implying delivery and optional error metadata.
- [Meta: error codes](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes)
  — 131026 has several causes, 131049 is ecosystem limiting, 131051 is an
  unsupported message type; none establishes a global address hard bounce.
- [Meta: changelog](https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog/)
  — operator must check the chosen API version during setup and future upgrades.

## Not yet verified

Account/app creation, test and production sender access, supported/approved
four-language templates, live subscription, real send/receipt proof, production
edge capacity, operator alerts and frontend acceptance are outstanding. Local
fixtures verify code behavior; they cannot satisfy these external gates.
