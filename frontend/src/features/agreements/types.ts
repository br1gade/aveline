/**
 * `GET /events/:eventId/acknowledgements` (docs/API.md §11), checked against the schema at each
 * call (FR-1). Read from the backend's `acknowledgements.service.ts` (`RECORD_SELECT`) at
 * `eb77cd4`. No guest is named: subjects and signers are ids (FR-49).
 */
export interface AgreementRecordWire {
  id: string;
  questionId: string;
  statementVersionId: string;
  subjectGuestId: string;
  signerGuestId: string;
  /** The name the signer typed, or gave with their drawing. */
  signerName: string;
  method: string;
  isRepresentative: boolean;
  /** The language the wording was shown in, and the wording itself, exactly as shown. */
  locale: string;
  statement: string;
  /** The drawing, for a drawn agreement. */
  mediaId: string | null;
  createdAt: string;
}

export interface AgreementsWire {
  items: AgreementRecordWire[];
  nextCursor: string | null;
}

export type AgreementRecord = AgreementRecordWire;

export interface AgreementsPage {
  records: AgreementRecord[];
  nextCursor: string | null;
}
