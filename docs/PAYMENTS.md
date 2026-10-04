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

Inecobank and IDBank share one adapter because they run the same ArCa protocol
(`register.do`, `getOrderStatusExtended.do`); only the base URL and credentials
differ.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/payments` | Register an order, return the bank form URL |
| `GET` | `/api/payments/:orderNumber` | Current state |
| `POST` | `/api/payments/:orderNumber/confirm` | Ask the bank what happened |
| `POST` | `/api/payments/:orderNumber/refund` | Full or partial refund |
| `POST` | `/api/payments/reconcile` | Sweep everything unresolved |

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
order that never completed, which is the worst failure this system has. It also
expires orders registered and never paid.

Every transition writes a `PaymentEvent` with the verbatim provider payload.
That table is append-only and is how a disagreement with the bank gets settled.

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
responds. `PaymentsModule` refuses to register it when `NODE_ENV=production`,
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
   needs a job (BullMQ on Redis — see [DATA_STORES.md](DATA_STORES.md)).
4. **Authenticate the endpoints.** Payments inherit the project-wide gap: there
   is no auth, so `/api/payments` is currently open. This must not ship.
5. **Decide two-step vs one-step** for deposits and request the authority.
6. **Confirm the callback mechanism** each bank offers. We poll on confirm and
   reconcile; if a bank pushes a webhook, its signature must be verified.

## 7. Not yet built

- **Ticketing.** `PaymentPurpose.TICKET` exists; the subsystem around it does
  not — `Event.visibility`, ticket tiers, concurrency-safe inventory, orders
  and issuance. Overselling under concurrent purchase is a correctness problem
  and is the hard part.
- **Subscriptions.** `PaymentPurpose.SUBSCRIPTION` exists. Recurring charges on
  these gateways mean **card binding** (storing a token with the bank and
  charging it later), which is a different API surface and usually a separate
  authorization from the bank.
- **Deposits wired to the booking flow.** The payment core supports it; nothing
  yet marks an event confirmed when a deposit captures.
- **Payouts to vendors.** `VendorBooking.feeAmount` records what is owed; no
  disbursement exists.
- **Invoicing and tax.**
