import type { ResponseOf } from '@/api/client';

/** From the schema (FR-1); `read.ts` alone reads the `…Wire` types. */
export type RequestWire = ResponseOf<'PrivacyController_listResponse'>[number];
export type SubmissionsWire = ResponseOf<'PrivacyController_submissionsResponse'>;

export type RequestKind = RequestWire['kind'];
export type RequestStatus = RequestWire['status'];

export interface DataRequest {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  /** `null` for one that came from an enquiry, whose subject the backend resolves. */
  subjectEmail: string | null;
  /** Staff's own: public text no longer joins them, though older notes may hold some (FR-126). */
  notes: string | null;
  /** An erasure applied with a step outstanding, which the request stays open to finish. */
  erasureAppliedAt: string | null;
  requestedAt: string;
  dueAt: string;
  /** The latest export made, which delivery is confirmed for (FR-128); `null` until one is. */
  exportGenerationId: string | null;
  exportGeneratedAt: string | null;
}

/** What the public form said, each time it was sent; never evidence of who sent it (FR-126). */
export interface Submission {
  id: string;
  notes: string | null;
  createdAt: string;
}

export interface SubmissionsPage {
  items: Submission[];
  hasMore: boolean;
  nextOffset: number;
}

export interface PrivateFile {
  mediaId: string;
}

/** What carrying a request out answered, kept only while the page is open. */
export type Carried =
  | { kind: 'export'; reference: string; result: unknown; files: PrivateFile[] }
  | {
      kind: 'erasure';
      reference: string;
      counts: ReadonlyArray<readonly [string, number]>;
      /** Applied, with one step left, and the request stays open until it is pressed again. */
      isRecoveryPending: boolean;
    };
