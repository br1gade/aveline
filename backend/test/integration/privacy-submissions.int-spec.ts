import { PrismaClient } from '@prisma/client';
import { privacyService } from '../fixtures/areas/privacy.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('unverified public privacy submissions', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  it('keeps every submission separate without modifying staff notes, standing or the original deadline', async () => {
    const request = await prisma.dataSubjectRequest.create({ data: {
      kind: 'ERASURE', subjectEmail: 'person@example.am', status: 'IN_PROGRESS',
      notes: 'Staff verified identity separately', dueAt: new Date('2026-11-20T12:00:00Z'),
    } });
    const { service } = privacyService(prisma);
    const inputs = Array.from({ length: 12 }, (_, index) => `${index}:` + 'x'.repeat(1997));
    await Promise.all(inputs.map((notes) => service.submit({ kind: 'ERASURE', subjectEmail: 'PERSON@example.am', notes })));
    expect(await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({
      notes: request.notes, status: request.status, dueAt: request.dueAt,
    });
    const submissions = await prisma.$queryRaw<{ notes: string }[]>`SELECT notes FROM privacy_request_submissions WHERE "requestId" = ${request.id}`;
    expect(submissions.map((row) => row.notes).sort()).toEqual(inputs.sort());
    expect(await prisma.dataSubjectRequest.count()).toBe(1);
  });

  it('serializes simultaneous first submissions into one open case without losing notes', async () => {
    const { service } = privacyService(prisma);
    const notes = ['First', 'Another', 'Third', 'Fourth'];
    await Promise.all(notes.map((value) => service.submit({ kind: 'EXPORT', subjectEmail: 'person@example.am', notes: value })));
    expect(await prisma.dataSubjectRequest.count()).toBe(1);
    const submissions = await prisma.$queryRaw<{ notes: string }[]>`SELECT notes FROM privacy_request_submissions`;
    expect(submissions.map((row) => row.notes).sort()).toEqual(notes.sort());
  });
});
