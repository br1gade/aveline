/** Interim until FR-1: the schema declares no answers. */
export type RequestKind = 'EXPORT' | 'ERASURE' | 'RECTIFICATION';
export type RequestStatus = 'RECEIVED' | 'VERIFYING' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED';

export interface DataRequest {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  /** `null` for one that came from an enquiry, whose subject the backend resolves. */
  subjectEmail: string | null;
  notes: string | null;
  /** An erasure applied with a step outstanding, which the request stays open to finish. */
  erasureAppliedAt: string | null;
  requestedAt: string;
  dueAt: string;
}

export interface PrivateFile {
  mediaId: string;
}

/** What carrying a request out answered: a one-off, kept only while the page is open. */
export type Carried =
  | { kind: 'export'; reference: string; result: unknown; files: PrivateFile[] }
  | {
      kind: 'erasure';
      reference: string;
      counts: ReadonlyArray<readonly [string, number]>;
      /** Applied, with one step left, and the request stays open until it is pressed again. */
      isRecoveryPending: boolean;
    };
