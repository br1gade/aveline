import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDataSubjectRequestDto } from './dto/privacy.dto';

/** One deadline per open case; each public submission remains unverified, separate text. */
export function recordPublicSubmission(prisma: PrismaService, dto: CreateDataSubjectRequestDto, dueAt: Date) {
  const subjectEmail = dto.subjectEmail.trim().toLowerCase();
  return prisma.$transaction(async (tx) => {
    const lock = `privacy:public:${dto.kind}:${subjectEmail}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))::text`;
    // Lock the case too, so a simultaneous staff completion cannot receive a new open-case submission.
    const open = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM data_subject_requests
      WHERE "subjectEmail" = ${subjectEmail} AND kind = ${dto.kind}::"DataSubjectRequestKind"
        AND status IN ('RECEIVED', 'VERIFYING', 'IN_PROGRESS')
      ORDER BY "requestedAt", id LIMIT 1 FOR UPDATE`;
    const request = open[0] ?? await tx.dataSubjectRequest.create({
      data: { kind: dto.kind, subjectEmail, dueAt }, select: { id: true },
    });
    await tx.privacyRequestSubmission.create({ data: { requestId: request.id, notes: dto.notes ?? null } });
    return request;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
