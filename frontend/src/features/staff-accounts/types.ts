import type { ResponseOf } from '@/api/client';

/** One of Aveline's staff, as `GET /staff` lists them. */
export type StaffAccount = ResponseOf<'StaffController_grantResponse'>;

export type StaffRole = StaffAccount['role'];

/** The lesser role first: the one the form starts on. */
export const STAFF_ROLES = ['SUPPORT', 'ADMIN'] as const satisfies readonly StaffRole[];

/** `GET /staff` answers at most this many, ordered by address. */
export const STAFF_LIST_LIMIT = 200;

export function otherRole(role: StaffRole): StaffRole {
  return role === 'ADMIN' ? 'SUPPORT' : 'ADMIN';
}
