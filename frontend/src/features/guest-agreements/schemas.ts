import { z } from 'zod';

import { SIGNER_NAME_LIMIT } from '@/features/guest-reply';

/**
 * An agreement's own checks, with the API's limits (§11): agreed, a name of 1 to 200 characters,
 * a checked drawing when drawn, and the declaration when it covers anyone else. Every problem is
 * said at once. Messages are codes, worded with the reply form's own words.
 */
export type AgreementCode = 'agree' | 'signerName' | 'tooLong' | 'drawing' | 'onBehalf';

export function agreementSchema(isForOthers: boolean) {
  return z
    .object({
      isAcknowledged: z.boolean(),
      isOnBehalf: z.boolean(),
      method: z.enum(['TYPED', 'DRAWN']),
      signerName: z.string(),
      assetId: z.string(),
    })
    .superRefine((values, context) => {
      const at = (path: string, message: AgreementCode) =>
        context.addIssue({ code: 'custom', path: [path], message });
      const name = values.signerName.trim();
      if (!values.isAcknowledged) at('isAcknowledged', 'agree');
      if (name === '') at('signerName', 'signerName');
      if (name.length > SIGNER_NAME_LIMIT) at('signerName', 'tooLong');
      if (values.method === 'DRAWN' && values.assetId === '') at('assetId', 'drawing');
      if (isForOthers && !values.isOnBehalf) at('isOnBehalf', 'onBehalf');
    });
}
