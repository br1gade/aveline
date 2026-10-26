import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { lockOperators, lockStaff } from './enquiry-access';
import { rememberAddresses } from './enquiry-addresses';
import { authorizeCase, replayCommand } from './enquiry-command';
import { assertIntakeEnabled, intakeKeys } from './enquiry-config';
import { intentFingerprint, validateIdempotencyKey } from './enquiry-intent';
import { lockIntake } from './enquiry-lock';
import { projectEnquiry } from './enquiry-projection';
import { mergeContact } from './enquiry-rules';
import { CreateEnquiryDto, EnquiryRequirementsDto } from './dto/enquiry.dto';
import { validateTimezone } from './enquiry-rules';

export function requirementData(requirements: EnquiryRequirementsDto | undefined) {
  if (requirements?.approximateTimezone) validateTimezone(requirements.approximateTimezone);
  const date = requirements?.approximateLocalDate;
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date)) throw new BadRequestException('requirements.approximateLocalDate must be a real YYYY-MM-DD');
  return { ...requirements, approximateLocalDate: date === undefined ? undefined : date && new Date(`${date}T00:00:00Z`) };
}

export async function createEnquiry(tx: Prisma.TransactionClient, input: { userId: string; key: string; dto: CreateEnquiryDto }, config: ConfigService) {
  assertIntakeEnabled(config);
  validateIdempotencyKey(input.key);
  await lockIntake(tx);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`intake:create:${input.userId}:${input.key}`},0))`;
  const contact = mergeContact(null, input.dto.contact);
  const requirements = requirementData(input.dto.requirements);
  const intent = { ...input.dto, contact, requirements, userId: input.userId, operation: 'CREATE' };
  const previous = await tx.enquiryCommand.findUnique({ where: { actorUserId_operation_idempotencyKey: { actorUserId: input.userId, operation: 'CREATE', idempotencyKey: input.key } } });
  if (previous?.enquiryId) {
    await authorizeCase(tx, { userId: input.userId, enquiryId: previous.enquiryId }, config);
    return (await replayCommand(tx, { userId: input.userId, enquiryId: previous.enquiryId, operation: 'CREATE', key: input.key, intent }, config))!;
  }
  const actor = await lockStaff(tx, input.userId);
  if (actor.platformRole === 'SUPPORT' && config.get<string>('SALES_INTAKE_SUPPORT_ENABLED') !== 'true') throw new ForbiddenException('Staff intake support is not enabled');
  if (actor.platformRole === 'SUPPORT' && Object.hasOwn(input.dto, 'assignedUserId')) throw new BadRequestException('assignedUserId is ADMIN-only');
  const assignedUserId = actor.platformRole === 'SUPPORT' ? actor.id : input.dto.assignedUserId ?? null;
  if (assignedUserId) await lockOperators(tx, [assignedUserId]);
  const enquiry = await tx.salesEnquiry.create({ data: { ...requirements, preferredLocale: input.dto.preferredLocale, source: input.dto.source, assignedUserId, createdByUserId: actor.id, contact: { create: contact } }, select: { id: true, contact: { select: { id: true } } } });
  await rememberAddresses(tx, enquiry.contact!.id, contact);
  await tx.enquiryActivity.create({ data: { enquiryId: enquiry.id, enquiryRevision: 1, actorUserId: actor.id, kind: 'CREATE' } });
  const command = await tx.enquiryCommand.create({ data: { actorUserId: actor.id, operation: 'CREATE', idempotencyKey: input.key, requestFingerprint: intentFingerprint(intent, intakeKeys(config)), enquiryId: enquiry.id, appliedRevision: 1, responseStatus: 201 } });
  return { commandId: command.id, appliedRevision: 1, resultId: null, enquiry: await projectEnquiry(tx, enquiry.id) };
}
