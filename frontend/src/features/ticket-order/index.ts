/**
 * The buyer's order (docs/API.md §5, design PD-81 and PD-82): opened from its emailed capability
 * link, straight after checkout, or on the bank's return, which is confirmed first. The order's
 * token is held by this tab only (`token-store.ts`).
 */
export { OrderPage } from './components/order-page';
export { bankAddress } from './redirect';
export { forgetOrder, heldOrder, holdOrder, type HeldOrder } from './token-store';
