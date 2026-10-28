import { describe, expect, it, vi } from 'vitest';

import type { Invitation } from '@/features/invitation-renderer';

import { readAcknowledgements } from './acknowledgements';
import { initialValues, newPartyRow, replySchema, type ReplyFormValues } from './form-model';
import { buildPayload } from './payload';
import { pollUpload } from './signature-upload';
import {
  coveredGuests,
  currentStatements,
  EMPTY_SIGNATURE,
  type AcknowledgementRecord,
  type SignatureContext,
  type Statement,
} from './signatures';
import { contextWith, QUESTIONS, recordWith } from './test-data';

const STATEMENT: Statement = {
  questionId: 'q-sign',
  statementVersionId: 'sv-2',
  prompt: 'Photos may be shared',
  required: true,
  locale: 'en',
};
const SIGNER = { guestId: 'g1', name: 'Armen Petrosyan' };

function contextFor(records: AcknowledgementRecord[] = []): SignatureContext {
  return {
    statements: [STATEMENT],
    covered: coveredGuests([STATEMENT], records),
    signer: SIGNER,
  };
}

function record(subjectGuestId: string, statementVersionId = 'sv-2'): AcknowledgementRecord {
  return {
    id: `a-${subjectGuestId}`,
    questionId: 'q-sign',
    statementVersionId,
    subjectGuestId,
    method: 'TYPED',
    createdAt: '2027-03-01T10:00:00.000Z',
  };
}

const start = initialValues(recordWith(), QUESTIONS);

function attending(change: Partial<ReplyFormValues> = {}): ReplyFormValues {
  return {
    ...start,
    status: 'ATTENDING',
    answers: { ...start.answers, 'q-main': '0' },
    members: [{ ...start.members[0]!, answers: { ...start.members[0]!.answers, 'q-main': '0' } }],
    ...change,
  };
}

function issues(values: ReplyFormValues, signatures = contextFor()) {
  const schema = replySchema({
    questions: QUESTIONS,
    neverAnswered: new Set(['g2']),
    venueIds: [],
    signatures,
  });
  const result = schema.safeParse(values);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`);
}

describe('the statements to agree to', () => {
  const invitation = {
    locale: 'hy',
    rsvpQuestions: [
      {
        id: 'q-sign',
        type: 'SIGNATURE',
        required: true,
        prompt: 'Լուսանկարներ',
        options: [],
        statementVersionId: 'sv-2',
      },
    ],
  } as unknown as Invitation;

  it('use the page’s own wording while it is current, and the new one when it changed', () => {
    expect(currentStatements(invitation, null)).toEqual([
      { ...STATEMENT, prompt: 'Լուսանկարներ', locale: 'hy' },
    ]);
    const changed = { ...STATEMENT, statementVersionId: 'sv-3', prompt: 'New wording' };
    expect(
      currentStatements(invitation, { statements: [changed], records: [], uploads: [] }),
    ).toEqual([changed]);
  });

  it('count only agreements to the current wording', () => {
    const covered = coveredGuests([STATEMENT], [record('g1'), record('g2', 'sv-1')]);
    expect([...(covered.get('q-sign') ?? [])]).toEqual(['g1']);
  });
});

describe('agreeing before sending', () => {
  it('asks everyone coming to agree to a required statement, and nobody declining', () => {
    expect(issues(attending())).toEqual(['signatures.q-sign.isAcknowledged:agree']);
    expect(issues({ ...start, status: 'DECLINED' })).toEqual([]);
  });

  it('needs a name, a drawing when drawn, and the declaration for the others', () => {
    const agreed = { ...EMPTY_SIGNATURE, isAcknowledged: true, method: 'DRAWN' as const };
    expect(issues(attending({ signatures: { 'q-sign': agreed } }))).toEqual([
      'signatures.q-sign.signerName:signerName',
      'signatures.q-sign.assetId:drawing',
      'signatures.q-sign.isOnBehalf:onBehalf',
    ]);
  });

  it('asks nothing of a household that has already agreed to this wording', () => {
    expect(issues(attending(), contextFor([record('g1'), record('g2')]))).toEqual([]);
  });

  it('asks the respondent alone, for themselves, when the others have agreed', () => {
    const typed = { ...EMPTY_SIGNATURE, isAcknowledged: true, signerName: 'Armen Petrosyan' };
    expect(
      issues(attending({ signatures: { 'q-sign': typed } }), contextFor([record('g2')])),
    ).toEqual([]);
  });
});

describe('the agreements sent', () => {
  const typed = {
    ...EMPTY_SIGNATURE,
    isAcknowledged: true,
    isOnBehalf: true,
    signerName: ' Armen Petrosyan ',
  };

  it('go into each person’s answers, on behalf of everyone but the signer', () => {
    const values = attending({
      signatures: { 'q-sign': typed },
      party: [{ ...newPartyRow(QUESTIONS), firstName: 'Narek', answers: { 'q-main': '1' } }],
    });
    const body = buildPayload(values, start, { ...contextWith(), signatures: contextFor() });
    const agreement = {
      statementVersionId: 'sv-2',
      method: 'TYPED',
      signerName: 'Armen Petrosyan',
      isAcknowledged: true,
      locale: 'en',
    };
    expect(body.answers).toContainEqual({ questionId: 'q-sign', value: agreement });
    expect(body.members?.[0]?.answers).toContainEqual({
      questionId: 'q-sign',
      value: { ...agreement, isRepresentative: true },
    });
    expect(body.party?.[0]?.answers).toContainEqual({
      questionId: 'q-sign',
      value: { ...agreement, isRepresentative: true },
    });
  });

  it('name the drawing when drawn, and send a member unchanged otherwise only to agree', () => {
    const drawn = { ...typed, method: 'DRAWN' as const, assetId: 'm1' };
    const before = { ...start, members: [{ ...start.members[0]!, status: 'ATTENDING' as const }] };
    const values = { ...attending({ signatures: { 'q-sign': drawn } }), members: before.members };
    const body = buildPayload(values, before, { ...contextWith(), signatures: contextFor() });
    expect(body.members).toMatchObject([
      {
        guestId: 'g2',
        status: 'ATTENDING',
        answers: [
          {
            questionId: 'q-sign',
            value: { method: 'DRAWN', assetId: 'm1', isRepresentative: true },
          },
        ],
      },
    ]);
    expect(body.members?.[0]?.answers).toHaveLength(1);
  });

  it('send nothing for an optional statement left unagreed', () => {
    const optional = { ...STATEMENT, required: false };
    const signatures = { ...contextFor(), statements: [optional] };
    const body = buildPayload(attending(), start, { ...contextWith(), signatures });
    expect(JSON.stringify(body)).not.toContain('statementVersionId');
  });
});

describe('the acknowledgements read', () => {
  it('keeps only what the form needs, and reads an upload it cannot use as failed', () => {
    const read = readAcknowledgements({
      statements: [
        {
          questionId: 'q-sign',
          statementVersionId: 'sv-2',
          required: true,
          prompt: 'Text',
          locale: 'en',
        },
        {
          questionId: 'q-old',
          statementVersionId: null,
          required: false,
          prompt: null,
          locale: 'en',
        },
      ],
      records: [
        {
          ...record('g1'),
          method: 'DRAWN',
          signerGuestId: 'g1',
          statement: 'Text',
          mediaId: 'm1',
        } as never,
      ],
      signatureUploads: [
        { id: 'm1', processingStatus: 'READY' },
        { id: 'm2', processingStatus: 'REMOVED' },
        { id: 'm3', processingStatus: 'PROCESSING' },
      ],
    });
    expect(read.statements.map((statement) => statement.questionId)).toEqual(['q-sign']);
    expect(read.records[0]).toEqual({ ...record('g1'), method: 'DRAWN' });
    expect(read.uploads.map((upload) => upload.status)).toEqual(['READY', 'FAILED', 'PROCESSING']);
  });
});

describe('waiting for a drawing to be checked', () => {
  const noWait = () => Promise.resolve();

  it('stops at READY or FAILED', async () => {
    const read = vi
      .fn<() => Promise<'QUEUED' | 'READY'>>()
      .mockResolvedValueOnce('QUEUED')
      .mockResolvedValueOnce('READY');
    const signal = new AbortController().signal;
    await expect(pollUpload({ read, wait: noWait, signal })).resolves.toBe('READY');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('gives up after its waits, and stops when the page stops waiting', async () => {
    const read = vi.fn(() => Promise.resolve('PROCESSING' as const));
    await expect(
      pollUpload({ read, wait: noWait, signal: new AbortController().signal }),
    ).resolves.toBe('TIMEOUT');
    const stopped = new AbortController();
    stopped.abort();
    await expect(pollUpload({ read, wait: noWait, signal: stopped.signal })).resolves.toBe(
      'TIMEOUT',
    );
  });
});
