import { DomainHttpException } from '../../../common/domain-http.exception';
import { PlatformRole, Prisma } from '@prisma/client';

export async function assertTemplateAuthor(tx: Prisma.TransactionClient, intent: { userId: string; templateId: string; isAdminOnly?: boolean }) {
  await tx.$queryRaw`SELECT id FROM users WHERE id=${intent.userId} FOR SHARE`;
  const user = await tx.user.findUnique({ where: { id: intent.userId }, select: { isActive: true, deletedAt: true, platformRole: true } });
  if (!user?.isActive || user.deletedAt) throw new DomainHttpException('TEMPLATE_ACTION_FORBIDDEN', 'An active staff account is required');
  if (user.platformRole === PlatformRole.ADMIN) return;
  const assignment = await tx.templateAssignment.findUnique({ where: { templateId_userId: { templateId: intent.templateId, userId: intent.userId } } });
  if (intent.isAdminOnly || user.platformRole !== PlatformRole.SUPPORT || !assignment || assignment.revokedAt) {
    throw new DomainHttpException('TEMPLATE_ACTION_FORBIDDEN', 'Only ADMIN or explicitly assigned SUPPORT can author this template');
  }
}
