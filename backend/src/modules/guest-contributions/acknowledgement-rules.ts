import { AcknowledgementMethod } from '@prisma/client';

export interface SignatureAnswer {
  statementVersionId: string;
  method: AcknowledgementMethod;
  signerName: string;
  isAcknowledged: true;
  isRepresentative?: boolean;
  assetId?: string;
  locale: string;
}
const KEYS = ['statementVersionId', 'method', 'signerName', 'isAcknowledged', 'isRepresentative', 'assetId', 'locale'];

export function signatureAnswerProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'must be an acknowledgement object';
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => !KEYS.includes(key))) return 'contains unknown acknowledgement fields';
  return identityProblem(data) ?? methodProblem(data);
}
function identityProblem(data: Record<string, unknown>): string | null {
  if (!isText(data.statementVersionId, 100) || !isText(data.locale, 16)) return 'needs statementVersionId and locale';
  if (!isText(data.signerName, 200) || data.isAcknowledged !== true) return 'needs signerName and explicit acknowledgement';
  if (data.isRepresentative !== undefined && typeof data.isRepresentative !== 'boolean') return 'isRepresentative must be boolean';
  return null;
}
function methodProblem(data: Record<string, unknown>): string | null {
  if (data.method === 'TYPED') return data.assetId === undefined ? null : 'typed acknowledgements cannot attach an image';
  if (data.method === 'DRAWN' && isText(data.assetId, 100)) return null;
  return 'DRAWN needs assetId; method must be TYPED or DRAWN';
}

function isText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !value.includes(String.fromCharCode(0));
}
