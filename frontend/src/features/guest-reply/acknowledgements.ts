import type {
  AcknowledgementRecord,
  AcknowledgementsRead,
  SignatureMethod,
  SignatureUpload,
  Statement,
  UploadStatus,
} from './signatures';

/**
 * `GET …/acknowledgements` (docs/API.md §11), interim until FR-1. Read by naming each field kept:
 * the records also carry the rendered statement and the signer's ids, which the form never needs.
 */
interface StatementWire {
  questionId: string;
  statementVersionId: string | null;
  required: boolean;
  prompt: unknown;
  locale: string;
}

interface RecordWire {
  id: string;
  questionId: string;
  statementVersionId: string;
  subjectGuestId: string;
  method: string;
  createdAt: string;
}

interface UploadWire {
  id: string;
  processingStatus: string;
}

export interface AcknowledgementsWire {
  statements: StatementWire[];
  records: RecordWire[];
  signatureUploads: UploadWire[];
}

/** The upload's processing state; anything removed or unknown cannot be used, as failed. */
const UPLOAD_STATUS: Readonly<Record<string, UploadStatus>> = {
  STAGING: 'QUEUED',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
};

function readStatement(wire: StatementWire): Statement[] {
  if (!wire.statementVersionId) return [];
  return [
    {
      questionId: wire.questionId,
      statementVersionId: wire.statementVersionId,
      prompt: typeof wire.prompt === 'string' ? wire.prompt : '',
      required: wire.required,
      locale: wire.locale,
    },
  ];
}

function readRecord(wire: RecordWire): AcknowledgementRecord {
  const method: SignatureMethod = wire.method === 'DRAWN' ? 'DRAWN' : 'TYPED';
  return {
    id: wire.id,
    questionId: wire.questionId,
    statementVersionId: wire.statementVersionId,
    subjectGuestId: wire.subjectGuestId,
    method,
    createdAt: wire.createdAt,
  };
}

function readUpload(wire: UploadWire): SignatureUpload {
  return {
    id: wire.id,
    status: Object.hasOwn(UPLOAD_STATUS, wire.processingStatus)
      ? (UPLOAD_STATUS[wire.processingStatus] ?? 'FAILED')
      : 'FAILED',
  };
}

export function readAcknowledgements(wire: AcknowledgementsWire): AcknowledgementsRead {
  return {
    statements: wire.statements.flatMap(readStatement),
    records: wire.records.map(readRecord),
    uploads: wire.signatureUploads.map(readUpload),
  };
}
