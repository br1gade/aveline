import { describe, expect, it } from 'vitest';

import { groupAgreements, type StatementInfo } from './group';
import { readRecord } from './read';
import { recordWire } from './test-data';

const STATEMENTS: StatementInfo[] = [
  { questionId: 'q-photos', currentVersionId: 'v2', prompt: 'Photos may be shared' },
  { questionId: 'q-rules', currentVersionId: 'r1', prompt: 'I accept the venue’s rules' },
];
const NAMES = new Map([
  ['g1', 'Armen Petrosyan'],
  ['g2', 'Lusine Petrosyan'],
]);

const records = [
  recordWire({
    id: 'a3',
    subjectGuestId: 'g2',
    signerGuestId: 'g1',
    isRepresentative: true,
    method: 'DRAWN',
    mediaId: 'sig-1',
  }),
  recordWire({
    id: 'a2',
    statementVersionId: 'v1',
    statement: 'Photos may be posted',
    createdAt: '2027-04-01T09:30:00.000Z',
  }),
  recordWire({ id: 'a1', locale: 'ru', statement: 'Фото можно публиковать' }),
].map(readRecord);

describe('agreements per statement and wording (PD-66)', () => {
  it('follows the questions’ order, the current wording first, then earlier ones', () => {
    const groups = groupAgreements(records, STATEMENTS, NAMES);
    expect(groups.map((group) => group.questionId)).toEqual(['q-photos', 'q-rules']);
    const photos = groups[0];
    expect(
      photos?.wordings.map((wording) => [wording.statementVersionId, wording.isCurrent]),
    ).toEqual([
      ['v2', true],
      ['v1', false],
    ]);
    expect(groups[1]?.wordings).toEqual([]);
  });

  it('keeps every language a wording was read in, as it was shown', () => {
    const current = groupAgreements(records, STATEMENTS, NAMES)[0]?.wordings[0];
    expect(current?.texts).toEqual([
      { locale: 'en', text: 'Photos may be shared' },
      { locale: 'ru', text: 'Фото можно публиковать' },
    ]);
  });

  it('names the guest, and the one who agreed on their behalf', () => {
    const rows = groupAgreements(records, STATEMENTS, NAMES)[0]?.wordings[0]?.rows;
    expect(rows?.[0]).toMatchObject({
      subject: 'Lusine Petrosyan',
      signer: 'Armen Petrosyan',
      isOnBehalf: true,
      method: 'DRAWN',
      hasDrawing: true,
    });
    expect(rows?.[1]).toMatchObject({
      subject: 'Armen Petrosyan',
      isOnBehalf: false,
      hasDrawing: false,
    });
  });

  it('keeps a guest it cannot name, and a statement the design no longer lists', () => {
    const stray = readRecord(
      recordWire({ id: 'x', questionId: 'q-gone', subjectGuestId: 'g9', signerGuestId: 'g9' }),
    );
    const groups = groupAgreements([stray], STATEMENTS, NAMES);
    const last = groups.at(-1);
    expect(last).toMatchObject({
      questionId: 'q-gone',
      isListed: false,
      hasCurrent: null,
      prompt: null,
    });
    expect(last?.wordings[0]?.rows[0]).toMatchObject({
      subject: null,
      signerName: 'Armen Petrosyan',
    });
  });

  it('says whether anyone agreed to the current wording', () => {
    const earlierOnly = groupAgreements(
      [records[1]].flatMap((r) => (r ? [r] : [])),
      STATEMENTS,
      NAMES,
    );
    expect(earlierOnly[0]?.hasCurrent).toBe(false);
    expect(groupAgreements(records, STATEMENTS, NAMES)[0]?.hasCurrent).toBe(true);
  });
});

describe('agreements when the design could not be read', () => {
  it('neither calls a statement unlisted nor any wording current or earlier', () => {
    const groups = groupAgreements(records, null, NAMES);
    expect(groups.map((group) => [group.questionId, group.isListed, group.hasCurrent])).toEqual([
      ['q-photos', null, null],
    ]);
    expect(
      groups[0]?.wordings.map((wording) => [wording.statementVersionId, wording.isCurrent]),
    ).toEqual([
      ['v2', null],
      ['v1', null],
    ]);
  });

  it('cannot tell the current wording of a question that names none', () => {
    const unknown = [{ questionId: 'q-photos', currentVersionId: null, prompt: 'Photos' }];
    const group = groupAgreements(records, unknown, NAMES)[0];
    expect(group?.hasCurrent).toBeNull();
    expect(group?.wordings.every((wording) => wording.isCurrent === null)).toBe(true);
  });
});

describe('reading a record', () => {
  it('keeps only the fields it names', () => {
    const read = readRecord({ ...recordWire(), token: 'leaked' } as never);
    expect(JSON.stringify(read)).not.toContain('leaked');
  });
});
