import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EnquiriesService } from './enquiries.service';
import { authorizeOperator, createConsultation, mapConsultationError, updateConsultation } from './consultation-mutations';
import { ConsultationAvailabilityDto, CreateConsultationDto, UpdateConsultationDto } from './dto/consultation.dto';

@Injectable()
export class ConsultationsService {
  constructor(private readonly prisma: PrismaService, private readonly enquiries: EnquiriesService) {}

  create(userId: string, enquiryId: string, input: { key: string; dto: CreateConsultationDto }) {
    return this.enquiries.command(userId, enquiryId, { key: input.key, operation: 'CONSULTATION_CREATE', intent: input.dto, expectedRevision: input.dto.expectedRevision, apply: (tx, root) => createConsultation(tx, root, { userId, dto: input.dto }) }).catch(mapConsultationError);
  }

  update(userId: string, enquiryId: string, input: { key: string; consultationId: string; dto: UpdateConsultationDto }) {
    return this.enquiries.command(userId, enquiryId, { key: input.key, operation: 'CONSULTATION_UPDATE', intent: { ...input.dto, consultationId: input.consultationId }, expectedRevision: input.dto.expectedRevision, apply: (tx, root) => updateConsultation(tx, root, { userId, consultationId: input.consultationId, dto: input.dto }) }).catch(mapConsultationError);
  }

  availability(userId: string, query: ConsultationAvailabilityDto) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const duration = to.getTime() - from.getTime();
    if (!Number.isFinite(duration) || duration <= 0 || duration > 31 * 86400000) throw new BadRequestException('to must be after from and within 31 days');
    return this.prisma.$transaction(async (tx) => {
      await authorizeOperator(tx, { userId, operatorUserId: query.operatorUserId });
      const busy = await tx.consultation.findMany({ where: { operatorUserId: query.operatorUserId, status: 'SCHEDULED', startsAt: { lt: to }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true }, orderBy: { startsAt: 'asc' } });
      return { operatorUserId: query.operatorUserId, busy };
    });
  }
}
