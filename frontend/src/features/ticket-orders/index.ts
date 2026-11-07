/**
 * An event's ticket orders (docs/API.md §5; design PD-87 to PD-89): by status, an order's people
 * and tickets, cancelling and refunding, registering who holds a legacy ticket and linking an
 * invited guest. Every read is a `clientLoader`, so there is no `index.server.ts`.
 */
export { OrdersPage } from './components/orders-page';
export { loadOrders } from './load';
