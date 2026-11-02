import { Prisma } from '@prisma/client';

/** Export only the subject's factual identity links; no template copy or other staff identities. */
export async function exportTemplateAuthorship(tx: Prisma.TransactionClient, email: string) {
  const user = await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
  if (!user) return null;
  const [drafts, publications, assignments, audit, receipts] = await Promise.all([
    tx.templateDraft.findMany({ where: { createdByUserId: user.id }, select: { id: true, templateId: true, state: true, createdAt: true } }),
    tx.designTemplateVersion.findMany({ where: { publishedByUserId: user.id }, select: { id: true, templateId: true, versionNumber: true, publishedAt: true } }),
    tx.templateAssignment.findMany({ where: { userId: user.id }, select: { templateId: true, createdAt: true, revokedAt: true } }),
    tx.templateAudit.findMany({ where: { actorUserId: user.id }, select: { templateId: true, action: true, revision: true, createdAt: true } }),
    tx.templateReceipt.findMany({ where: { actorUserId: user.id }, select: { scopeKey: true, createdAt: true } }),
  ]);
  return { drafts, publications, assignments, audit, receipts };
}
export async function revokeTemplateAuthorship(tx: Prisma.TransactionClient, userId: string, now: Date) {
  await tx.templateAssignment.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  await tx.templatePreview.updateMany({ where: { actorUserId: userId, expiresAt: { gt: now } }, data: { expiresAt: now } });
  await tx.templateMaterialization.updateMany({ where: { actorUserId: userId, state: { in: ['PROCESSING', 'READY'] } }, data: { state: 'RETIRED', expiresAt: now } });
  await tx.$executeRaw`UPDATE design_template_assets a SET state='RETIRED',"leaseOwner"=NULL,"leaseUntil"=NULL,"leaseGeneration"="leaseGeneration"+1
    WHERE a."createdByUserId"=${userId} AND NOT EXISTS (SELECT 1 FROM design_template_asset_references r WHERE r."assetId"=a.id)`;
  await tx.$executeRaw`UPDATE design_template_stored_objects o SET state='RETIRED',"cleanupAfter"=${now}
    WHERE o."assetId" IN (SELECT id FROM design_template_assets WHERE "createdByUserId"=${userId} AND state='RETIRED')
    OR o."materializationId" IN (SELECT id FROM template_materializations WHERE "actorUserId"=${userId} AND state='RETIRED')`;
}
