import type { AgreementRecord } from './types';

/** A SIGNATURE question as the design lists it: its current wording, and its words for the host. */
export interface StatementInfo {
  questionId: string;
  /** `null` when the question names no current wording: then none is called current or earlier. */
  currentVersionId: string | null;
  prompt: string | null;
}

export interface AgreementRow {
  id: string;
  /** The guest the agreement covers; `null` when the guest list does not name them. */
  subject: string | null;
  /** The guest who agreed, from the list; `null` when it does not name them. */
  signer: string | null;
  /** The name they typed, or gave with their drawing. */
  signerName: string;
  /** Agreed by someone else in the household, who declared they could (docs/API.md §11). */
  isOnBehalf: boolean;
  method: 'TYPED' | 'DRAWN';
  hasDrawing: boolean;
  locale: string;
  createdAt: string;
}

/** One wording of a statement: what guests read, in each language they read it in. */
export interface Wording {
  statementVersionId: string;
  /** `null` when the current wording is not known (the design could not be read). */
  isCurrent: boolean | null;
  texts: Array<{ locale: string; text: string }>;
  rows: AgreementRow[];
}

export interface StatementGroup {
  questionId: string;
  prompt: string | null;
  /** `false` for a question the design no longer lists; `null` when the design could not be read. */
  isListed: boolean | null;
  /** Whether anyone agreed to the current wording, which is what counts at the door; `null` when
   * the current wording is not known. */
  hasCurrent: boolean | null;
  wordings: Wording[];
}

function rowOf(record: AgreementRecord, names: ReadonlyMap<string, string>): AgreementRow {
  return {
    id: record.id,
    subject: names.get(record.subjectGuestId) ?? null,
    signer: names.get(record.signerGuestId) ?? null,
    signerName: record.signerName,
    isOnBehalf: record.signerGuestId !== record.subjectGuestId,
    method: record.method === 'DRAWN' ? 'DRAWN' : 'TYPED',
    hasDrawing: record.method === 'DRAWN' && record.mediaId !== null,
    locale: record.locale,
    createdAt: record.createdAt,
  };
}

/** The wordings of one question, newest first as the records come, the current one ahead. */
function wordingsOf(
  records: readonly AgreementRecord[],
  currentVersionId: string | null,
  names: ReadonlyMap<string, string>,
): Wording[] {
  const byVersion = new Map<string, Wording>();
  for (const record of records) {
    const wording = byVersion.get(record.statementVersionId) ?? {
      statementVersionId: record.statementVersionId,
      isCurrent: currentVersionId === null ? null : record.statementVersionId === currentVersionId,
      texts: [],
      rows: [],
    };
    if (
      !wording.texts.some((text) => text.locale === record.locale && text.text === record.statement)
    ) {
      wording.texts.push({ locale: record.locale, text: record.statement });
    }
    wording.rows.push(rowOf(record, names));
    byVersion.set(record.statementVersionId, wording);
  }
  const wordings = [...byVersion.values()];
  return [
    ...wordings.filter((w) => w.isCurrent === true),
    ...wordings.filter((w) => w.isCurrent !== true),
  ];
}

/**
 * The agreements per statement, in the design's order, then any question it no longer lists; per
 * wording, the current first; per guest, newest first, as the backend sends them (design PD-66).
 * Without the design (`null`), statements follow the records and nothing is called current.
 */
export function groupAgreements(
  records: readonly AgreementRecord[],
  statements: readonly StatementInfo[] | null,
  names: ReadonlyMap<string, string>,
): StatementGroup[] {
  const listed = new Set((statements ?? []).map((statement) => statement.questionId));
  const strays = [...new Set(records.map((record) => record.questionId))].filter(
    (id) => !listed.has(id),
  );
  const all: StatementInfo[] = [
    ...(statements ?? []),
    ...strays.map((questionId) => ({ questionId, currentVersionId: null, prompt: null })),
  ];
  return all.map((statement) => {
    const own = records.filter((record) => record.questionId === statement.questionId);
    const wordings = wordingsOf(own, statement.currentVersionId, names);
    return {
      questionId: statement.questionId,
      prompt: statement.prompt,
      isListed: statements === null ? null : listed.has(statement.questionId),
      hasCurrent:
        statement.currentVersionId === null ? null : wordings.some((wording) => wording.isCurrent),
      wordings,
    };
  });
}
