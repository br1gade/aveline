import { describe, expect, it } from 'vitest';

import type { Signee, Statement } from '@/features/guest-reply';

import { agreeBody, EMPTY_AGREEMENT } from './payload';

const RULES: Statement = {
  questionId: 'q-rules',
  statementVersionId: 'v2',
  prompt: 'I accept the house rules',
  required: true,
  locale: 'hy',
};
const ANNA: Signee = { key: 'g-anna', guestId: 'g-anna', name: 'Anna' };
const DAVIT: Signee = { key: 'g-davit', guestId: 'g-davit', name: 'Davit' };

describe('the agreement sent on its own (docs/API.md §11)', () => {
  it('names the current wording, its language, the signer and each person covered', () => {
    const body = agreeBody(
      { ...EMPTY_AGREEMENT, isAcknowledged: true, signerName: '  Anna Sargsyan ' },
      { statement: RULES, signees: [ANNA], agreed: [] },
      'g-anna',
    );
    expect(body).toEqual({
      statementVersionId: 'v2',
      subjectGuestIds: ['g-anna'],
      method: 'TYPED',
      signerName: 'Anna Sargsyan',
      isAcknowledged: true,
      locale: 'hy',
    });
  });

  it('declares the signer a representative when it covers anyone else', () => {
    const body = agreeBody(
      { ...EMPTY_AGREEMENT, isAcknowledged: true, isOnBehalf: true, signerName: 'Anna' },
      { statement: RULES, signees: [ANNA, DAVIT], agreed: [] },
      'g-anna',
    );
    expect(body).toMatchObject({ subjectGuestIds: ['g-anna', 'g-davit'], isRepresentative: true });
  });

  it('sends a drawing’s id only when signing by drawing', () => {
    const drawn = agreeBody(
      {
        ...EMPTY_AGREEMENT,
        isAcknowledged: true,
        method: 'DRAWN',
        assetId: 'm1',
        signerName: 'Anna',
      },
      { statement: RULES, signees: [ANNA], agreed: [] },
      'g-anna',
    );
    expect(drawn).toMatchObject({ method: 'DRAWN', assetId: 'm1' });
    const typed = agreeBody(
      { ...EMPTY_AGREEMENT, isAcknowledged: true, assetId: 'm1', signerName: 'Anna' },
      { statement: RULES, signees: [ANNA], agreed: [] },
      'g-anna',
    );
    expect(typed).not.toHaveProperty('assetId');
  });
});
