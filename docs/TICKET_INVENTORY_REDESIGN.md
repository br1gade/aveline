# Ticket selection and inventory redesign

Status: the backend supports per-show inventory and mixed seat and zone purchases. The separate frontend branch adds the organizer editor, CSV import and buyer picker.

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
2. Keep a single nullable order claim on each numbered seat row and lock it when claiming. Use conditional updates on unnumbered section counters so concurrent orders and different price offers cannot exceed the shared capacity. A ticket type quota, where present, is an additional check in the same transaction.
3. Settle once. A captured order turns its existing allocations into sales and issues one ticket per attendee. An abandoned checkout releases the same allocations with the existing expiry rules. A confirmed cancellation releases the seats or zone capacity when its tickets are voided. An uncertain refund keeps the allocation unavailable until the order outcome is resolved.
4. If money arrives after a hold was released, attempt to reclaim the exact numbered seats or capacity in the original zones. Issue only if the complete allocation can still be honoured. Otherwise refund the full order through the existing late-payment path. Never substitute a different seat or zone automatically.

## Implementation and acceptance

1. Publish reusable venue layout versions and select them for event venues. This is implemented for directory venues. The manual editor supports up to 5,000 numbered seats. CSV import supports up to 75,000 seats across 100 sections.
2. The event inventory, offer and allocation schema and public section availability API are implemented. A show publishes one inventory snapshot before it has any ticket orders. Ticket types with an offer can be deactivated.
3. The allocation now follows checkout, settlement, expiry and cancellation. Test competing buyers for seats, prices sharing zone capacity, mixed-basket rollback, repeated requests and callbacks, and late captures with and without the original inventory available.
4. The organizer editor and buyer picker are on a separate frontend branch. Verify the organizer-to-buyer-to-door journey against a seeded backend in all four supported languages, including keyboard and mobile seat selection. Paid operation follows the pilot and provider gates.

This redesign starts with named attendees. Transferable or unnamed tickets, table-based ticket maps, graphical venue charts and automatic suggestions for adjacent seats can be specified separately.
