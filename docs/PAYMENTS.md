# Payments

Armenian card acquiring through Ameriabank, Inecobank and IDBank.

> **Status:** the provider-agnostic core and all three adapters are built and
> tested. No bank has issued credentials yet, so no adapter has been exercised
> against a real sandbox. See [§6](#6-before-go-live).

---

## 1. All three banks are the same shape

Ameriabank vPOS, Inecobank eCommerce and IDBank's IDPay are **hosted-redirect
gateways**, most routing through ArCa, Armenia's national scheme. The flow is
identical, which is why one port with thin adapters is cheaper and more honest
than three bespoke integrations.

```
  our server          the bank                 the payer
      │                   │                        │
      ├─ register order ─►│                        │
      │◄─ form URL ───────┤                        │
      ├───────────────────┼─ redirect to form ────►│
      │                   │◄─ card details ────────┤   ← on the bank's domain,
      │                   │                        │     never ours
      │◄──────────────────┼─ return redirect ──────┤
      ├─ GET status ─────►│                        │   ← THIS decides the outcome
      │◄─ captured ───────┤                        │
```

**The return redirect is never proof of payment.** It is attacker-controlled: a
payer can simply open the success URL. It only triggers the server-to-server
status check that actually decides the outcome. This is the single most common
way these integrations are got wrong.

Because the payer enters card details on the bank's domain, we never handle
card data and PCI scope stays minimal. Do not break that by proxying a form.

## 2. What is built

| Piece | File |
|---|---|
| Status machine | [`payment-status.ts`](../backend/src/modules/payments/payment-status.ts) |
| Gateway port + money conversion | [`providers/payment-provider.ts`](../backend/src/modules/payments/providers/payment-provider.ts) |
| Ameriabank vPOS adapter | [`providers/ameriabank.gateway.ts`](../backend/src/modules/payments/providers/ameriabank.gateway.ts) |
| Inecobank + IDBank (ArCa) adapter | [`providers/arca.gateway.ts`](../backend/src/modules/payments/providers/arca.gateway.ts) |
| In-process fake, for tests and local dev | [`providers/fake.gateway.ts`](../backend/src/modules/payments/providers/fake.gateway.ts) |
| Orchestration, idempotency, reconciliation | [`payments.service.ts`](../backend/src/modules/payments/payments.service.ts) |

`Refund` records each refund individually; `Payment.refundedMinor` is the
running total used to decide whether another one fits.

Inecobank and IDBank share one adapter because they run the same ArCa protocol
(`register.do`, `getOrderStatusExtended.do`); only the base URL and credentials
differ.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/payments/:orderNumber` | Current state |
| `POST` | `/api/payments/:orderNumber/confirm` | Ask the bank what happened |
| `POST` | `/api/payments/:orderNumber/refund` | Full or partial refund |
| `POST` | `/api/payments/reconcile` | Sweep everything unresolved |

There is no endpoint to start a payment. Ticket checkout and subscriptions
start their own, deciding organization, purpose and amount themselves; a
public one let anyone register a charge against any organization (removed
9 October 2026).

## 3. The four properties that matter

Everything below is what costs money when it is wrong.

**Money is integer minor units.** `amountMinor` is a `BigInt`, never a float,
never a `Decimal` someone can round. **AMD has no subunit** — it is quoted in
whole drams, so 25,000 AMD is `25000`, not `2500000`. Getting that exponent
wrong is a hundredfold error. `toMajorUnits` / `toMinorUnits` convert only at
the adapter boundary, and an unknown currency assumes two places because
under-charging is the safer direction to be wrong in.

**Idempotency is a database constraint, not a check.** `idempotencyKey` is
unique on the table. A read-then-create would still double-charge under genuine
concurrency; the constraint is what holds. Tested with three concurrent
identical requests resulting in exactly one payment.

**Status only moves forwards.** The transition table makes a captured payment
reverting to pending inexpressible. Transitions are a compare-and-set on the
status we read, so two concurrent callbacks cannot both apply.

**Reconciliation is not optional.** Callbacks get lost — an abandoned redirect,
a timed-out webhook. Without the sweep, a customer the bank charged has an
order that never completed, which is the worst failure this system has. It
asks the bank first and only then expires what the bank still calls unpaid —
expiring first wrote off payments the bank had captured, because `EXPIRED` is
final.

Every transition writes a `PaymentEvent` with the verbatim provider payload.
That table is append-only and is how a disagreement with the bank gets settled.

### Order of operations, and why it is that way

**The insert is the claim.** Registering a payment inserts the row first and
uses the unique constraint on `idempotencyKey` to decide who owns the right to
call the bank. A prior read cannot do this: two concurrent callers both read
nothing. Whoever's insert wins registers; the losers wait briefly for the
winner's result and return it, rather than registering a second order or
failing a retry that should have succeeded.

**A refund is claimed in the database before any money moves.** The obvious
reading — call the bank, then record it — is wrong. Two concurrent refunds
both read `refundedMinor` as zero, both pass the arithmetic check, and both
tell the bank to pay out. The second database write then fails, leaving the
books showing one refund and the statement showing two. Money that has left
cannot be un-sent.

Claiming first inverts which failure is possible: at worst we record a refund
the bank then rejects, which this code compensates for immediately and
reconciliation would catch regardless. The claim is a single conditional
`UPDATE` whose `WHERE` carries the invariant, so a second claim matches
nothing, and which sets `REFUNDED` or `PARTIALLY_REFUNDED` from the row as it
is then — two part refunds that complete a payment together leave it
`REFUNDED`.

**A refund the bank may have made is never asked for again.** Only an
explicit refusal (`BankDeclinedError`) gives the claimed amount back. A
timeout, a dropped connection, or our own write failing after the bank's yes
leaves the refund `PENDING` with "outcome unknown" in `failureReason`, the
amount still claimed, and a `502` to the caller — staff confirm with the bank.
Releasing it, as every failure once did, let the next attempt pay out twice.
The claim and its `Refund` row are one transaction.

**A refund succeeds only when the bank says so.** Both banks answer a declined
refund with HTTP 200; the adapters read Ameriabank's `ResponseCode` and ArCa's
`errorCode` and throw on anything but success, and amounts go in the
payment's own currency.

**Ticket settlement is one transaction, claim first.** Committing inventory
and issuing tickets happen together, behind a conditional update that only
matches a `RESERVED` order. Ticket codes are random, so without that guard a
retried callback would mint a second valid set for one paid seat rather than
failing on a constraint.

**Money that arrives late still buys what it was for, or goes back.** A ticket
hold lasts 15 minutes; a payment can land later. The release sweep asks the
bank about every lapsed hold that started a payment and settles a captured one
instead of releasing it. A capture found after release is issued from the
seats still free (`sellLate`), or — when they were sold meanwhile — refunded
in full, claim-first, and the buyer told (decided 9 October 2026). A refused
refund reopens the claim for the next sweep. Invoices follow the same rule:
captured pays them, unless a newer plan change had voided them, in which case
the payment is refunded.

**Every reconciliation is followed by settlement.** `MoneySweepService`
reconciles, then settles captured ticket orders and invoices — the customers
who paid and never returned. Reconciliation used to update only the payment.

**A checkout that fails after its order exists expires the order**,
claim-first, which returns its seats once. Releasing them beside a `RESERVED`
order let the sweep return them again, and a later buyer's payment failed to
commit.

**Confirmation emails cannot be lost.** They are queued after settlement with
a dedupe key; a retried settlement queues again (a no-op if it exists), and a
sweep queues any paid or cancelled order from the last week that has none.

These are covered by `test/integration/transaction-safety.int-spec.ts` and
`ticket-settlement.int-spec.ts`, which run the concurrent cases rather than
reasoning about them.

## 4. Sandboxes

| Bank | Test endpoint | Notes |
|---|---|---|
| Ameriabank | `servicestest.ameriabank.am` (docs at `/VPOS/help`) | Test OrderIDs restricted to 2350301–2350400, amount 10 AMD |
| Inecobank | `ipaytest.inecobank.am` | Production `ipay.inecobank.am` |
| IDBank | `ipayproxy.idp.am` | Least public documentation |

**Ameriabank requires certification:** at least five successful completed REST
payments in test before production access. One-step payments, refund and cancel
are enabled by default; **two-step (authorize then capture) must be requested
separately** — relevant if deposits should hold rather than charge.

Credentials require a business account and, in practice, a visit to the bank.
A provider is registered only when its username is set, so unconfigured banks
simply do not appear rather than failing when a customer tries to pay.

### Local development

The `FAKE` provider runs the entire flow in process, so registration, redirect,
confirmation, refunds and reconciliation are all exercisable before any bank
responds. `PaymentsModule` registers it only when `NODE_ENV` is `development` or `test`,
because it would otherwise let anyone mint a paid order.

## 5. Apple Pay and Google Pay

**Apple Pay is live in Armenia** — Acba, Ardshinbank, Ameriabank, Converse,
Inecobank and Unibank. For Ameriabank it is an *activation on your existing
vPOS merchant*, not a separate integration, so it arrives through the same
gateway with no adapter change.

It does need backend work we have not done: an Apple merchant ID and **domain
verification**, serving a file at
`/.well-known/apple-developer-merchantid-domain-association`.

**Google Pay could not be confirmed** for Armenian e-commerce acquiring. Ask
the bank directly before scoping it; do not assume parity with Apple Pay.

Visa, Mastercard and ArCa come with any of the three gateways.

## 6. Before go-live

1. **Verify every field name** against the specification your bank sends. The
   adapters are our best reading of published integrations and are marked with
   a warning where that matters. Everything deciding business outcomes lives in
   `PaymentsService`, so corrections stay inside one adapter.
2. **Run the certification** each bank requires.
3. **Schedule reconciliation.** Nothing calls `/reconcile` on a timer yet; it
   needs a job (BullMQ on Redis — see [DATA_STORES.md](../backend/docs/DATA_STORES.md)).
4. **Authenticate the endpoints.** Payments inherit the project-wide gap: there
   is no auth, so `/api/payments` is currently open. This must not ship.
5. **Decide two-step vs one-step** for deposits and request the authority.
6. **Confirm the callback mechanism** each bank offers. We poll on confirm and
   reconcile; if a bank pushes a webhook, its signature must be verified.

## 7. What uses it

**Ticketing** is built on this core: checkout registers a payment, and
confirming it commits inventory and issues tickets. Ticketing calls payments
rather than the reverse, so payments stays ignorant of what it is paying for.
See [PRODUCT_SPEC.md](PRODUCT_SPEC.md) §13.

## 8. Not yet built

- **Subscriptions.** `Plan`, `Subscription` and `Invoice` are modelled, and
  `Subscription.bindingRef` is where a stored-card token goes. Nothing charges
  or renews yet. Recurring charges on these gateways mean **card binding** —
  the bank holds the card and returns a token — which is a different API
  surface and usually a separate authorization from the bank.
- **Deposits wired to the booking flow.** The payment core supports it; nothing
  yet marks an event confirmed when a deposit captures.
- **Tax.** `Invoice.taxMinor` holds an amount; nothing computes one.
- **Payouts to vendors.** `VendorBooking.feeMinor` records what is owed;
  disbursement needs a banking relationship we do not have.
- **Refund execution against a real bank.** The `Refund` model and the gateway
  calls exist but have never run against a sandbox.
