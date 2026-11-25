import type { ResponseOf } from '@/api/client';

/** Counts across every customer, now; staff-owned organizations left out (docs/API.md). */
export type PilotTotals = ResponseOf<'StaffController_statsResponse'>;
