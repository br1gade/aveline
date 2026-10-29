import type { AgreementRecord, AgreementRecordWire, AgreementsPage, AgreementsWire } from './types';

/** Each field named, so nothing else a record may carry goes further (ARCHITECTURE §9). */
export function readRecord(wire: AgreementRecordWire): AgreementRecord {
  return {
    id: wire.id,
    questionId: wire.questionId,
    statementVersionId: wire.statementVersionId,
    subjectGuestId: wire.subjectGuestId,
    signerGuestId: wire.signerGuestId,
    signerName: wire.signerName,
    method: wire.method,
    isRepresentative: wire.isRepresentative,
    locale: wire.locale,
    statement: wire.statement,
    mediaId: wire.mediaId ?? null,
    createdAt: wire.createdAt,
  };
}

export function readPage(wire: AgreementsWire): AgreementsPage {
  return { records: wire.items.map(readRecord), nextCursor: wire.nextCursor ?? null };
}
