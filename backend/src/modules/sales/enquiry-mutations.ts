import { DomainHttpException } from '../../common/domain-http.exception';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma, SalesEnquiry } from '@prisma/client';
import { lockOperators, lockStaff } from './enquiry-access';
import { rememberAddresses } from './enquiry-addresses';
import { requirementData } from './enquiry-create';
import { addCalendarMonths, mergeContact } from './enquiry-rules';
import { AssignEnquiryDto, EnquiryNoteDto, StageEnquiryDto, UpdateEnquiryDto } from './dto/enquiry.dto';

export async function updateEnquiry(tx: Prisma.TransactionClient, root: SalesEnquiry, dto: UpdateEnquiryDto) {
  if (dto.contact) {
    const current = await tx.enquiryContact.findUniqueOrThrow({ where: { enquiryId: root.id } });
    const contact = mergeContact(current, dto.contact);
    await rememberAddresses(tx, current.id, contact);
    await tx.enquiryContact.update({ where: { id: current.id }, data: { ...contact, revision: { increment: 1 } } });
  }
  await tx.salesEnquiry.update({ where: { id: root.id }, data: { ...requirementData(dto.requirements), preferredLocale: dto.preferredLocale, source: dto.source } });
  return {};
}

export async function assignEnquiry(tx: Prisma.TransactionClient, root: SalesEnquiry, input: { userId: string; dto: AssignEnquiryDto }) {
  const actor = await lockStaff(tx, input.userId);
  if (actor.platformRole !== 'ADMIN') throw new ForbiddenException('Assignment is ADMIN-only');
  if (input.dto.assignedUserId) await lockOperators(tx, [input.dto.assignedUserId]);
  if (root.assignedUserId === input.dto.assignedUserId) throw new DomainHttpException('NO_CHANGE', 'NO_CHANGE');
  await tx.salesEnquiry.update({ where: { id: root.id }, data: { assignedUserId: input.dto.assignedUserId } });
  const appointmentsNeedingReview = await tx.consultation.count({ where: { enquiryId: root.id, status: 'SCHEDULED', operatorUserId: { not: input.dto.assignedUserId ?? '' } } });
  return { metadata: { assignedUserId: input.dto.assignedUserId, appointmentsNeedingReview } };
}

export async function changeEnquiryStage(tx: Prisma.TransactionClient, root: SalesEnquiry, dto: StageEnquiryDto) {
  validateStage(root, dto);
  const closedAt = dto.stage === 'CLOSED' ? new Date() : null;
  const closureReason = closedAt ? dto.closureReason : null;
  await tx.salesEnquiry.update({ where: { id: root.id }, data: { stage: dto.stage, closedAt, closureReason, closureNote: closedAt ? dto.closureNote ?? null : null, cleanupDueAt: closedAt ? addCalendarMonths(closedAt, 6) : null } });
  return { metadata: { stage: dto.stage, closureReason: closureReason ?? null } };
}

function validateStage(root: SalesEnquiry, dto: StageEnquiryDto): void {
  if (dto.stage !== 'CLOSED' && (dto.closureReason || dto.closureNote)) throw new BadRequestException('closureReason and closureNote are only accepted for CLOSED');
  if (root.stage === dto.stage) throw new DomainHttpException('NO_CHANGE', 'NO_CHANGE');
  if (dto.stage === 'CLOSED' && !dto.closureReason) throw new BadRequestException('closureReason is required for CLOSED');
  if (root.personalDataClearedAt && dto.closureNote) throw new DomainHttpException('SUBJECT_ERASED', 'SUBJECT_ERASED');

}

export async function appendEnquiryNote(tx: Prisma.TransactionClient, root: SalesEnquiry, input: { userId: string; dto: EnquiryNoteDto }) {
  const body = input.dto.body.trim();
  if (!body || body.length > 10000) throw new BadRequestException('body must be 1–10000 characters');
  if (input.dto.consultationId && !await tx.consultation.findUnique({ where: { id_enquiryId: { id: input.dto.consultationId, enquiryId: root.id } }, select: { id: true } })) throw new BadRequestException('consultationId must belong to this enquiry');
  const note = await tx.enquiryNote.create({ data: { enquiryId: root.id, createdByUserId: input.userId, body, consultationId: input.dto.consultationId, kind: input.dto.consultationId ? 'CONSULTATION' : 'GENERAL' }, select: { id: true } });
  return { resultId: note.id, metadata: { noteId: note.id } };
}
