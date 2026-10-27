import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { authorizeCase, applyCommand, EnquiryCommandInput } from './enquiry-command';
import { createEnquiry } from './enquiry-create';
import { appendEnquiryNote, assignEnquiry, changeEnquiryStage, updateEnquiry } from './enquiry-mutations';
import { AssignEnquiryDto, CreateEnquiryDto, EnquiryNoteDto, StageEnquiryDto, UpdateEnquiryDto, EnquiryPageDto, EnquiryQueueDto } from './dto/enquiry.dto';
import { projectEnquiry } from './enquiry-projection';
import { listEnquiries, readSection } from './enquiry-query';

@Injectable()
export class EnquiriesService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  create(userId: string, key: string, dto: CreateEnquiryDto) {
    return this.prisma.$transaction((tx) => createEnquiry(tx, { userId, key, dto }, this.config));
  }

  command(userId: string, enquiryId: string, input: EnquiryCommandInput) {
    return this.prisma.$transaction((tx) => applyCommand(tx, { userId, enquiryId }, input, this.config));
  }

  update(userId: string, enquiryId: string, input: { key: string; dto: UpdateEnquiryDto }) {
    return this.command(userId, enquiryId, { ...input, operation: 'UPDATE', intent: input.dto, expectedRevision: input.dto.expectedRevision, apply: (tx, root) => updateEnquiry(tx, root, input.dto) });
  }

  assign(userId: string, enquiryId: string, input: { key: string; dto: AssignEnquiryDto }) {
    return this.command(userId, enquiryId, { ...input, operation: 'ASSIGN', intent: input.dto, expectedRevision: input.dto.expectedRevision, canWriteCleared: true, apply: (tx, root) => assignEnquiry(tx, root, { userId, dto: input.dto }) });
  }

  stage(userId: string, enquiryId: string, input: { key: string; dto: StageEnquiryDto }) {
    return this.command(userId, enquiryId, { ...input, operation: 'STAGE', intent: input.dto, expectedRevision: input.dto.expectedRevision, canWriteCleared: true, apply: (tx, root) => changeEnquiryStage(tx, root, input.dto) });
  }

  addNote(userId: string, enquiryId: string, input: { key: string; dto: EnquiryNoteDto }) {
    return this.command(userId, enquiryId, { ...input, operation: 'NOTE', intent: input.dto, expectedRevision: input.dto.expectedRevision, apply: (tx, root) => appendEnquiryNote(tx, root, { userId, dto: input.dto }) });
  }

  detail(userId: string, enquiryId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { actor } = await authorizeCase(tx, { userId, enquiryId, isWrite: false }, this.config);
      const [enquiry, notes, activities, consultations, deliveries] = await Promise.all([
        projectEnquiry(tx, enquiryId), readSection(tx, enquiryId, { section: 'notes', query: { limit: 20 } }),
        readSection(tx, enquiryId, { section: 'activities', query: { limit: 20 } }), readSection(tx, enquiryId, { section: 'consultations', query: { limit: 20 } }),
        tx.ownerInviteDelivery.findMany({ where: { enquiryId }, select: { id: true, state: true }, take: 20 }),
      ]);
      return { ...enquiry, notes, activities, consultations, deliveries, permissions: { canAssign: actor.platformRole === 'ADMIN', canManage: true } };
    });
  }

  list(userId: string, query: EnquiryQueueDto) {
    return this.prisma.$transaction((tx) => listEnquiries(tx, { userId, query }, this.config));
  }

  section(userId: string, enquiryId: string, input: { section: 'notes' | 'activities' | 'consultations'; query: EnquiryPageDto }) {
    return this.prisma.$transaction(async (tx) => {
      await authorizeCase(tx, { userId, enquiryId, isWrite: false }, this.config);
      return readSection(tx, enquiryId, input);
    });
  }
}
