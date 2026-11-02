import { describe, expect, it } from 'vitest';

import type { Signee, Statement } from '@/features/guest-reply';

import { doorAgreements, isForOthers } from './door';

const RULES: Statement = {
  questionId: 'q-rules',
  statementVersionId: 'v2',
  prompt: 'I accept the house rules',
  required: true,
  locale: 'en',
};
const PHOTOS: Statement = {
  ...RULES,
  questionId: 'q-photos',
  statementVersionId: 'p1',
  required: false,
};

const ANNA: Signee = { key: 'g-anna', guestId: 'g-anna', name: 'Anna' };
const DAVIT: Signee = { key: 'g-davit', guestId: 'g-davit', name: 'Davit' };

describe('agreeing before the door (PD-83)', () => {
  it('asks each current statement of everyone coming who has not agreed to its wording', () => {
    const covered = new Map([['q-rules', new Set(['g-anna'])]]);
    expect(doorAgreements([RULES, PHOTOS], covered, [ANNA, DAVIT])).toEqual([
      { statement: RULES, signees: [DAVIT], agreed: [ANNA] },
      { statement: PHOTOS, signees: [ANNA, DAVIT], agreed: [] },
    ]);
  });

  it('asks nothing once everyone coming has agreed, or when nobody is coming', () => {
    const covered = new Map([
      ['q-rules', new Set(['g-anna', 'g-davit'])],
      ['q-photos', new Set(['g-anna', 'g-davit'])],
    ]);
    expect(doorAgreements([RULES, PHOTOS], covered, [ANNA, DAVIT])).toEqual([]);
    expect(doorAgreements([RULES], new Map(), [])).toEqual([]);
  });

  it('is on behalf of others when it covers anyone but the signer', () => {
    const [agreement] = doorAgreements([RULES], new Map(), [ANNA, DAVIT]);
    expect(isForOthers(agreement!, 'g-anna')).toBe(true);
    const [own] = doorAgreements([RULES], new Map(), [ANNA]);
    expect(isForOthers(own!, 'g-anna')).toBe(false);
    expect(isForOthers(own!, 'g-davit')).toBe(true);
  });
});
