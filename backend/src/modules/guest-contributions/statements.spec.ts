import { Prisma } from '@prisma/client';
import { versionStatement } from './statements';

describe('Statement revisions', () => {
  it('keeps revisions increasing after a signature question was temporarily another type', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'revision-4' });
    const tx = { questionStatement: { aggregate: jest.fn().mockResolvedValue({ _max: { revision: 3 } }), create },
      rsvpQuestion: { update: jest.fn().mockResolvedValue({}) } } as unknown as Prisma.TransactionClient;
    await versionStatement(tx, { id: 'question', type: 'SIGNATURE', prompt: { en: 'Statement' }, statementVersionId: null });
    expect(create).toHaveBeenCalledWith({ data: { questionId: 'question', revision: 4, prompt: { en: 'Statement' } } });
  });
});
