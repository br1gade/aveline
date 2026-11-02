import type { DoorAgreement } from './door';
import type { SignatureMethod } from '@/features/guest-reply';

/** One statement's form: the agreement, the declaration for others, and how it is signed. */
export interface AgreementValues {
  isAcknowledged: boolean;
  isOnBehalf: boolean;
  method: SignatureMethod;
  /** Left empty: typing it is the act of signing (design PD-52). */
  signerName: string;
  /** A READY drawing's id; '' until then. */
  assetId: string;
}

export const EMPTY_AGREEMENT: AgreementValues = {
  isAcknowledged: false,
  isOnBehalf: false,
  method: 'TYPED',
  signerName: '',
  assetId: '',
};

/** `POST …/g/:guestToken/acknowledgements`, as the generated `SignAcknowledgementDto` names it. */
export interface AgreementBody {
  statementVersionId: string;
  subjectGuestIds: string[];
  method: SignatureMethod;
  signerName: string;
  isAcknowledged: true;
  locale: string;
  isRepresentative?: true;
  assetId?: string;
}

/**
 * The agreement for everyone it covers, in the wording's own language. Anyone but the signer
 * makes the signer a representative; their names are never recorded as the signer's (§11).
 */
export function agreeBody(
  values: AgreementValues,
  agreement: DoorAgreement,
  signerId: string,
): AgreementBody {
  const subjectGuestIds = agreement.signees.flatMap((person) =>
    person.guestId ? [person.guestId] : [],
  );
  return {
    statementVersionId: agreement.statement.statementVersionId,
    subjectGuestIds,
    method: values.method,
    signerName: values.signerName.trim(),
    isAcknowledged: true,
    locale: agreement.statement.locale,
    ...(subjectGuestIds.some((id) => id !== signerId) ? { isRepresentative: true as const } : {}),
    ...(values.method === 'DRAWN' ? { assetId: values.assetId } : {}),
  };
}
