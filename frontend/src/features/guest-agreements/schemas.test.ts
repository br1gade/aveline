import { describe, expect, it } from 'vitest';

import { EMPTY_AGREEMENT } from './payload';
import { agreementSchema } from './schemas';

function issues(values: Partial<typeof EMPTY_AGREEMENT>, isForOthers = false) {
  const result = agreementSchema(isForOthers).safeParse({ ...EMPTY_AGREEMENT, ...values });
  return result.success
    ? []
    : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
}

describe('an agreement’s own checks', () => {
  it('needs the agreement itself and the signer’s name', () => {
    expect(issues({})).toEqual([
      ['isAcknowledged', 'agree'],
      ['signerName', 'signerName'],
    ]);
    expect(issues({ isAcknowledged: true, signerName: 'Anna' })).toEqual([]);
  });

  it('keeps the name within 200 characters', () => {
    expect(issues({ isAcknowledged: true, signerName: 'A'.repeat(201) })).toEqual([
      ['signerName', 'tooLong'],
    ]);
  });

  it('needs a checked drawing when signing by drawing', () => {
    expect(issues({ isAcknowledged: true, signerName: 'Anna', method: 'DRAWN' })).toEqual([
      ['assetId', 'drawing'],
    ]);
    expect(
      issues({ isAcknowledged: true, signerName: 'Anna', method: 'DRAWN', assetId: 'm1' }),
    ).toEqual([]);
  });

  it('needs the declaration when it covers anyone else', () => {
    expect(issues({ isAcknowledged: true, signerName: 'Anna' }, true)).toEqual([
      ['isOnBehalf', 'onBehalf'],
    ]);
    expect(issues({ isAcknowledged: true, signerName: 'Anna', isOnBehalf: true }, true)).toEqual(
      [],
    );
  });
});
