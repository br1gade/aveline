import type { AgreementRecordWire } from './types';

/** One agreement as the backend sends it: Armen agreed for himself, typed. */
export function recordWire(overrides: Partial<AgreementRecordWire> = {}): AgreementRecordWire {
  return {
    id: 'a1',
    questionId: 'q-photos',
    statementVersionId: 'v2',
    subjectGuestId: 'g1',
    signerGuestId: 'g1',
    signerName: 'Armen Petrosyan',
    method: 'TYPED',
    isRepresentative: false,
    locale: 'en',
    statement: 'Photos may be shared',
    mediaId: null,
    createdAt: '2027-05-01T09:30:00.000Z',
    ...overrides,
  };
}
