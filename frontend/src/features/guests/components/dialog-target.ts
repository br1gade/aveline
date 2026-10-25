import type { Guest, Household } from '../types';

/** What a dialog on the guest list is open for. One at a time, hosted by the list. */
export type DialogTarget =
  | { kind: 'add'; householdId: string }
  | { kind: 'edit'; guest: Guest; household: Household }
  | { kind: 'remove'; guest: Guest; household: Household }
  | { kind: 'household'; household: Household };
