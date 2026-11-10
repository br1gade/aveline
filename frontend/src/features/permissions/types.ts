import type { ResponseOf } from '@/api/client';

/** One of the backend's permissions, as the access reads name them (FR-6). */
export type Permission = ResponseOf<'EventsController_accessResponse'>['permissions'][number];

/** What an access read granted, or null while nothing is known: the read failed or was refused. */
export type Granted = readonly Permission[] | null;
