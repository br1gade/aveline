import { assertEnquiryAccess } from './enquiry-access';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnquiryConversion, Prisma, SalesEnquiry } from '@prisma/client';
import { DomainHttpException } from '../../common/domain-http.exception';
import { AccountService } from '../../infra/auth/account.service';
import { lockOwnerAddress } from '../../infra/auth/access-locks';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { lockExportPrivacy } from '../exports/export-privacy';
import { ConvertEnquiryDto } from './dto/enquiry-conversion.dto';
import { applyCommand, authorizeCase, replayCommand } from './enquiry-command';
import { assertIntakeEnabled, intakeKeys } from './enquiry-config';
import { ConversionTarget, resolveConversionTarget, validateConversionTarget } from './enquiry-conversion-target';
import { intentFingerprint, sameIntent, validateIdempotencyKey } from './enquiry-intent';
import { lockEnquiry, lockIntake } from './enquiry-lock';
import { projectEnquiry } from './enquiry-projection';
import { runEnquiryTransaction } from './enquiry-transaction';

@Injectable()
export class EnquiryConversionService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly events: EventsService, private readonly accounts: AccountService) {}

  convert(userId: string, enquiryId: string, input: { key: string; dto: ConvertEnquiryDto; organizationSelector?: string }) {
    assertIntakeEnabled(this.config);
    if (this.config.get<string>('SALES_ENQUIRY_CONVERSION_ENABLED') !== 'true') throw new NotFoundException('Not found');
    validateIdempotencyKey(input.key);
    validateConversionTarget(input.dto);
    return runEnquiryTransaction(this.prisma, async (tx) => {
      await lockExportPrivacy(tx);
      await lockIntake(tx);
      const command = { userId, enquiryId, ...input };
      const knownReplay = await this.replayIfKnown(tx, command);
      if (knownReplay) return knownReplay;
      if (input.dto.organization.create) await lockOwnerAddress(tx, input.dto.organization.create.ownerEmail);
      const root = await lockEnquiry(tx, enquiryId);
      // Another same-case conversion may have committed while the owner/root lock waited.
      const committedReplay = await this.replayIfKnown(tx, command);
      if (committedReplay) return committedReplay;
      const candidate = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, platformRole: true, isActive: true, deletedAt: true } });
      assertEnquiryAccess(candidate, root.assignedUserId);
      const target = await resolveConversionTarget(tx, input.dto, this.events);
      if (input.organizationSelector && input.organizationSelector !== target.organizationId) throw new DomainHttpException('ORGANIZATION_CONTEXT_MISMATCH', 'organization selector does not match conversion target');
      await authorizeCase(tx, { userId, enquiryId }, this.config);
      if (root.personalDataClearedAt) throw new DomainHttpException('SUBJECT_ERASED', 'SUBJECT_ERASED');
      const existing = await tx.enquiryConversion.findUnique({ where: { enquiryId } });
      if (existing && (existing.eventId || !input.dto.event)) return this.returnExisting(tx, { userId, root, existing, target, input });
      return { ...await applyCommand(tx, { userId, enquiryId }, { key: input.key, operation: 'CONVERT', intent: input.dto, expectedRevision: input.dto.expectedRevision,
        apply: (transaction) => this.linkSetup(transaction, { userId, root, target, dto: input.dto, existing }) }, this.config), wasExisting: Boolean(existing) };
    });
  }

  private async replayIfKnown(tx: Prisma.TransactionClient, input: { userId: string; enquiryId: string; key: string; dto: ConvertEnquiryDto; organizationSelector?: string }) {
    const receipt = await tx.enquiryCommand.findUnique({ where: { actorUserId_operation_idempotencyKey: { actorUserId: input.userId, operation: 'CONVERT', idempotencyKey: input.key } }, select: { id: true } });
    if (!receipt) return null;
    // A receipt reference grants no access. Live root/User standing must hold
    // before either checking a spent intent or projecting current case data.
    await authorizeCase(tx, { userId: input.userId, enquiryId: input.enquiryId }, this.config);
    const intent = { ...input.dto, userId: input.userId, enquiryId: input.enquiryId, operation: 'CONVERT' };
    const replay = await replayCommand(tx, { userId: input.userId, enquiryId: input.enquiryId, operation: 'CONVERT', key: input.key, intent }, this.config);
    if (!replay) throw new DomainHttpException('IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_CONFLICT');
    if (input.organizationSelector && input.organizationSelector !== replay.enquiry.organizationId) throw new DomainHttpException('ORGANIZATION_CONTEXT_MISMATCH', 'organization selector does not match conversion target');
    return { ...replay, wasExisting: true };
  }

  private async linkSetup(tx: Prisma.TransactionClient, input: { userId: string; root: SalesEnquiry; target: ConversionTarget; dto: ConvertEnquiryDto; existing: EnquiryConversion | null }) {
    const { target, dto, existing } = input;
    if (existing && target.organizationId !== existing.organizationId) throw new DomainHttpException('ENQUIRY_CHANGED', 'ENQUIRY_CHANGED');
    const organizationId = target.organizationId ?? (await tx.organization.create({ data: { name: dto.organization.create!.name, kind: dto.organization.create!.kind ?? 'HOST' }, select: { id: true } })).id;
    const ownerInviteId = existing?.ownerInviteId ?? await this.prepareOwnerInvite(tx, { ...input, organizationId });
    const eventId = dto.event?.create ? (await this.events.createInTransaction(tx, { organizationId, userId: input.userId, dto: dto.event.create, options: { isOnBehalf: true }, prepared: target.prepared })).id : target.eventId;
    const conversion = existing
      ? await tx.enquiryConversion.update({ where: { id: existing.id }, data: { eventId } })
      : await tx.enquiryConversion.create({ data: { enquiryId: input.root.id, organizationId, eventId, ownerInviteId, convertedByUserId: input.userId } });
    await tx.salesEnquiry.update({ where: { id: input.root.id }, data: { organizationId, eventId } });
    return { resultId: conversion.id, metadata: { conversionId: conversion.id, organizationId, eventId } };
  }

  private async prepareOwnerInvite(tx: Prisma.TransactionClient, input: { userId: string; root: SalesEnquiry; dto: ConvertEnquiryDto; organizationId: string }) {
    const setup = input.dto.organization.create;
    if (!setup) return null;
    const email = setup.ownerEmail.trim().toLowerCase();
    if (await tx.organizationMembership.count({ where: { organizationId: input.organizationId, user: { email: { equals: email, mode: 'insensitive' }, isActive: true } } })) return null;
    const contact = await tx.enquiryContact.findUniqueOrThrow({ where: { enquiryId: input.root.id }, select: { id: true, email: true } });
    if (setup.ownerEmailSource === 'PRIMARY_CONTACT' && contact.email !== email) throw new BadRequestException('organization.create.ownerEmail must match the explicitly selected primary contact');
    const invite = await this.accounts.inviteMemberInTransaction(tx, { organizationId: input.organizationId, invitedByUserId: input.userId, dto: { email, role: 'OWNER' }, reusePendingOwner: true, isConcierge: true });
    await tx.ownerInviteDelivery.upsert({ where: { organizationInviteId: invite.invitationId }, create: { organizationInviteId: invite.invitationId, enquiryId: input.root.id, privacyRevision: input.root.privacyRevision, sourceContactId: setup.ownerEmailSource === 'PRIMARY_CONTACT' ? contact.id : null, state: invite.messageId ? 'QUEUED' : 'NEEDS_REVIEW', messageId: invite.messageId }, update: {} });
    return invite.invitationId;
  }

  private async returnExisting(tx: Prisma.TransactionClient, input: { userId: string; root: SalesEnquiry; existing: EnquiryConversion; target: ConversionTarget; input: { key: string; dto: ConvertEnquiryDto } }) {
    const { root, existing, target } = input;
    if (target.organizationId !== existing.organizationId || (target.eventId && target.eventId !== existing.eventId)) throw new DomainHttpException('ENQUIRY_CHANGED', 'ENQUIRY_CHANGED');
    const original = await tx.enquiryCommand.findFirstOrThrow({ where: { enquiryId: root.id, operation: 'CONVERT', resultId: existing.id }, orderBy: { createdAt: 'asc' } });
    if (input.input.dto.event?.create) {
      const previousIntent = { ...input.input.dto, expectedRevision: original.appliedRevision - 1, userId: input.userId, enquiryId: root.id, operation: 'CONVERT' };
      if (!sameIntent(original.requestFingerprint, previousIntent, intakeKeys(this.config))) throw new DomainHttpException('ENQUIRY_CHANGED', 'ENQUIRY_CHANGED');
    }
    const intent = { ...input.input.dto, userId: input.userId, enquiryId: root.id, operation: 'CONVERT' };
    const command = await tx.enquiryCommand.create({ data: { actorUserId: input.userId, operation: 'CONVERT', idempotencyKey: input.input.key, requestFingerprint: intentFingerprint(intent, intakeKeys(this.config)), enquiryId: root.id, resultId: existing.id, appliedRevision: original.appliedRevision, responseStatus: 200 } });
    return { wasExisting: true, commandId: command.id, appliedRevision: original.appliedRevision, resultId: existing.id, enquiry: await projectEnquiry(tx, root.id) };
  }
}
