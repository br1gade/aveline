# Ticket selection and inventory redesign

Status: venue layout publishing and event selection are implemented in the follow-up. Checkout still sells quantities by ticket type. The allocation and buyer flows below specify the next implementation.

## Buyer and organizer flows

An event can offer numbered seats and unnumbered zones at the same time. For example, a buyer can select Balcony B12 and B13 and one standing ticket on the floor in one order. The first organizer editor supports sections, rows and numbered seats. An unnumbered section instead has a shared capacity and no seat coordinates.

A directory editor publishes reusable layouts for a physical venue. An organizer selects a version for each event venue, separately from the private guest table plan. Each screening or performance uses its own event. A 6 p.m. show and a 9 p.m. show can share a layout version and have independent inventory. Each section offers one or more prices through existing ticket types. A ticket type is a price and sales rule. Availability comes from the seat or section it sells. For example, adult and student floor tickets can have different prices while drawing on the same floor capacity. A ticket type may also have its own quota. The optional event-wide buyer limit
applies across all seats, zones and prices, using the checkout email.

The buyer sees the published sections, prices and availability before entering attendee details. The buyer selects an exact seat in a numbered section or a quantity in an unnumbered zone. The seat picker also offers a keyboard-accessible list with the same seat names and availability. At checkout the buyer assigns each selection to one named attendee. The basket shows the selection and, after the server accepts the order, the hold deadline. Each issued ticket identifies its seat or zone. Selecting seats together affects only seating.

## Inventory and layout

- A section belongs to an immutable venue layout version and is either numbered or unnumbered. Event stock belongs to the show, even when the venue layout is shared. Its stable ID is independent of the translated name shown to buyers. An unnumbered section has a capacity shared across its offers.
- A numbered seat belongs to a section and has a row label and seat label unique within that section. When an event publishes its selected layout for sale, its inventory gives each seat a stable ID and captures its display labels. Organizer blocks and unavailable seats are omitted from selectable availability.
- An offer maps an existing ticket type to an eligible section. The server checks the event, section, price offer and exact seat together. Legacy ticket types retain their current quantity behavior until an organizer adopts a layout. Do not assign existing ticket holders to new seats automatically.
- An allocation records which attendee, order, offer and seat or zone were selected. Keep the labels and price shown at checkout with the order so a later catalogue edit does not rewrite the receipt. Existing ticket codes remain the admission credential.
- Once inventory is active, an event layout with a hold or sale cannot change the section mode, remove or move the affected seats, or reduce a zone below its held and sold count. A venue can publish a new version for future events. Editing a display label cannot change an existing receipt. Event-private guest seating uses its existing tables, seat positions and publication rules.

## Checkout contract

Keep the current quantity checkout for events without a published ticket layout. For layout-enabled events, extend the public listing with a bounded layout summary and version. Provide a section availability read so a buyer never needs to load the entire map at once. These reads show selectable inventory, prices and display labels, without order, attendee or hold identities.

An extended order request includes the layout version and one selection per attendee. A numbered selection carries the exact seat ID and offer. An unnumbered selection carries the section ID and offer. One attendee consumes one place. Require the selected counts to match the basket, reject duplicates, reject mismatched sections or offers, and include all selections and the layout version in the idempotency fingerprint. Return the exact allocation and deadline on success. A stale layout or inventory conflict returns a structured `409` that identifies the affected selection so the buyer can refresh the section. The API validates availability when committing the hold.

## Hold, settlement and release

1. Validate the whole order, then create the order, claims, and attendee roster in one database transaction before contacting the bank. Free orders settle through the same allocation rules. Lock rows in a stable order and reject a basket as a whole if any selection is unavailable.
2. Back numbered claims with a unique database constraint for active holds and sales on a seat. Use conditional updates on unnumbered section counters so concurrent orders and different price offers cannot exceed the shared capacity. A ticket type quota, where present, is an additional check in the same transaction.
3. Settle once. A captured order turns its existing allocations into sales and issues one ticket per attendee. An abandoned checkout releases the same allocations with the existing expiry rules. A confirmed cancellation releases the seats or zone capacity when its tickets are voided. An uncertain refund keeps the allocation unavailable until the order outcome is resolved.
4. If money arrives after a hold was released, attempt to reclaim the exact numbered seats or capacity in the original zones. Issue only if the complete allocation can still be honoured. Otherwise refund the full order through the existing late-payment path. Never substitute a different seat or zone automatically.

## Implementation and acceptance

1. Publish reusable venue layout versions and select them for event venues. This is implemented for directory venues. The current editor payload is bounded to 5,000 numbered seats per layout. Large stadium maps need section uploads or an import workflow.
2. Add the event inventory, offer and allocation schema and public section availability API. Prove that existing orders continue through payment, expiry and cancellation, and test ownership, stale versions, capacity and organizer edit restrictions.
3. Connect allocation to checkout, settlement, expiry and cancellation. Exercise competing buyers on one seat and across two prices in a shared zone, mixed-basket rollback, repeated requests and callbacks, confirmed refunds, and late captures with and without the original inventory available.
4. Build the organizer editor and buyer picker on the frontend integration branch. Verify the organizer-to-buyer-to-door journey against a seeded backend in all four supported languages, including keyboard and mobile seat selection. Keep paid operation behind the existing pilot and provider gates.

This redesign starts with named attendees. Transferable or unnamed tickets, table-based ticket maps, imported venue charts and automatic suggestions for adjacent seats can be specified separately.
