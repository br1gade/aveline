import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, SalesEnquiry } from '@prisma/client';
import { lockOperators } from './enquiry-access';
import { CreateConsultationDto, UpdateConsultationDto } from './dto/consultation.dto';
import { validateConsultation } from './enquiry-rules';

export async function authorizeOperator(tx: Prisma.TransactionClient, input: { userId: string; operatorUserId: string }): Promise<void> {
  const staff = await lockOperators(tx, [input.userId, input.operatorUserId]);
  const actor = staff.find((operator) => operator.id === input.userId)!;
  if (actor.platformRole === 'SUPPORT' && input.operatorUserId !== input.userId) throw new ForbiddenException('operatorUserId must be the acting SUPPORT operator');
}

export async function createConsultation(tx: Prisma.TransactionClient, root: SalesEnquiry, input: { userId: string; dto: CreateConsultationDto }) {
  await authorizeOperator(tx, { userId: input.userId, operatorUserId: input.dto.operatorUserId });
  const interval = { startsAt: new Date(input.dto.startsAt), endsAt: new Date(input.dto.endsAt), timezone: input.dto.timezone };
  validateConsultation(interval);
  const consultation = await tx.consultation.create({ data: { enquiryId: root.id, operatorUserId: input.dto.operatorUserId, ...interval, createdByUserId: input.userId }, select: { id: true } });
  return { resultId: consultation.id, metadata: { consultationId: consultation.id } };
}

export async function updateConsultation(tx: Prisma.TransactionClient, root: SalesEnquiry, input: { userId: string; consultationId: string; dto: UpdateConsultationDto }) {
  const previous = await tx.consultation.findUnique({ where: { id_enquiryId: { id: input.consultationId, enquiryId: root.id } } });
  if (!previous) throw new NotFoundException('No such consultation');
  if (previous.revision !== input.dto.expectedConsultationRevision) throw new ConflictException('ENQUIRY_CHANGED');
  if (previous.status !== 'SCHEDULED') throw new BadRequestException('status is terminal; create a new consultation');
  const operatorUserId = input.dto.operatorUserId ?? previous.operatorUserId;
  await authorizeOperator(tx, { userId: input.userId, operatorUserId });
  const interval = mergedInterval(previous, input.dto);
  validateConsultation(interval);
  const status = input.dto.status ?? previous.status;
  await tx.consultation.update({ where: { id: previous.id }, data: { ...interval, operatorUserId, status, revision: { increment: 1 }, completedAt: status === 'COMPLETED' ? new Date() : null, cancelledAt: status === 'CANCELLED' ? new Date() : null } });
  return { resultId: previous.id, metadata: { consultationId: previous.id, status } };
}

export function mapConsultationError(error: unknown): never {
  const isKnownOverlap = error instanceof Prisma.PrismaClientKnownRequestError && /consultation_operator_no_overlap|23P01/.test(JSON.stringify(error.meta));
  const isUnknownOverlap = error instanceof Prisma.PrismaClientUnknownRequestError && error.message.includes('23P01') && error.message.includes('consultation_operator_no_overlap');
  if (isKnownOverlap || isUnknownOverlap) throw new ConflictException('CONSULTATION_CONFLICT');
  throw error;
}

function mergedInterval(previous: { startsAt: Date; endsAt: Date; timezone: string }, dto: UpdateConsultationDto) {
  return { startsAt: dto.startsAt ? new Date(dto.startsAt) : previous.startsAt, endsAt: dto.endsAt ? new Date(dto.endsAt) : previous.endsAt, timezone: dto.timezone ?? previous.timezone };
}
