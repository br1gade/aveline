import { DomainHttpException } from '../../common/domain-http.exception';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SalesEnquiry } from '@prisma/client';
import { assertEnquiryAccess, lockStaff } from './enquiry-access';
import { assertIntakeEnabled, intakeKeys } from './enquiry-config';
import { intentFingerprint, sameIntent, validateIdempotencyKey } from './enquiry-intent';
import { lockEnquiry, lockIntake } from './enquiry-lock';
import { projectEnquiry } from './enquiry-projection';

export interface ApplyResult { resultId?: string; metadata?: Prisma.InputJsonObject }
export interface EnquiryCommandInput {
  key: string;
  operation: string;
  intent: object;
  expectedRevision: number;
  canWriteCleared?: boolean;
  apply: (tx: Prisma.TransactionClient, root: SalesEnquiry) => Promise<ApplyResult>;
}

export async function authorizeCase(tx: Prisma.TransactionClient, input: { userId: string; enquiryId: string; isWrite?: boolean }, config: ConfigService) {
  assertIntakeEnabled(config);
  await lockIntake(tx);
  const root = await lockEnquiry(tx, input.enquiryId, input.isWrite ?? true);
  const actor = await lockStaff(tx, input.userId);
  if (actor.platformRole === 'SUPPORT' && config.get<string>('SALES_INTAKE_SUPPORT_ENABLED') !== 'true') throw new ForbiddenException('Staff intake support is not enabled');
  assertEnquiryAccess(actor, root.assignedUserId);
  return { root, actor };
}

export async function replayCommand(tx: Prisma.TransactionClient, input: { userId: string; enquiryId: string; operation: string; key: string; intent: object }, config: ConfigService) {
  const receipt = await tx.enquiryCommand.findUnique({ where: { actorUserId_operation_idempotencyKey: { actorUserId: input.userId, operation: input.operation, idempotencyKey: input.key } } });
  if (!receipt) return null;
  if (receipt.enquiryId !== input.enquiryId) throw new DomainHttpException('IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_CONFLICT');
  if (receipt.invalidatedAt || !receipt.requestFingerprint) throw new DomainHttpException('SUBJECT_ERASED', 'SUBJECT_ERASED');
  if (!sameIntent(receipt.requestFingerprint, input.intent, intakeKeys(config))) throw new DomainHttpException('IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_CONFLICT');
  return { commandId: receipt.id, appliedRevision: receipt.appliedRevision, resultId: receipt.resultId, enquiry: await projectEnquiry(tx, input.enquiryId) };
}

export async function applyCommand(tx: Prisma.TransactionClient, target: { userId: string; enquiryId: string }, input: EnquiryCommandInput, config: ConfigService) {
  validateIdempotencyKey(input.key);
  const { root } = await authorizeCase(tx, target, config);
  const intent = { ...input.intent, userId: target.userId, enquiryId: target.enquiryId, operation: input.operation };
  const replay = await replayCommand(tx, { ...target, ...input, intent }, config);
  if (replay) return replay;
  if (root.revision !== input.expectedRevision) throw new DomainHttpException('ENQUIRY_CHANGED', 'ENQUIRY_CHANGED');
  if (root.personalDataClearedAt && !input.canWriteCleared) throw new DomainHttpException('SUBJECT_ERASED', 'SUBJECT_ERASED');
  const result = await input.apply(tx, root);
  const revision = root.revision + 1;
  await tx.salesEnquiry.update({ where: { id: root.id }, data: { revision } });
  await tx.enquiryActivity.create({ data: { enquiryId: root.id, enquiryRevision: revision, actorUserId: target.userId, kind: input.operation, metadata: result.metadata ?? {} } });
  const command = await tx.enquiryCommand.create({ data: { actorUserId: target.userId, operation: input.operation, idempotencyKey: input.key, requestFingerprint: intentFingerprint(intent, intakeKeys(config)), enquiryId: root.id, resultId: result.resultId, appliedRevision: revision, responseStatus: 200 } });
  return { commandId: command.id, appliedRevision: revision, resultId: result.resultId, enquiry: await projectEnquiry(tx, root.id) };
}
