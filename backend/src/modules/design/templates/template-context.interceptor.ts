import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { RequestActor } from '../../../infra/auth/actor';
import { lockOrganizationStanding } from '../../../infra/auth/access-locks';
import { parseOrganizationSelector, resolveOrganizationContext } from '../../../infra/auth/organization-context';
import { lockAuthorTemplate } from './template-authoring.service';
import { assertTemplateAuthor } from './template-policy';

/** Platform permission and an assignment never turn a stale tab's selector into another tenant. */
@Injectable()
export class TemplateContextInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<Request<Record<string, string>, unknown, Record<string, unknown>> & { actor: RequestActor }>();
    const selector = parseOrganizationSelector(request.headers, request.rawHeaders);
    if (!selector) return next.handle();
    const templateId = request.params.templateId;
    const organizationId = typeof request.body?.organizationId === 'string' ? request.body.organizationId : undefined;
    if (!templateId && !organizationId) return next.handle();
    await this.prisma.$transaction(async (tx) => {
      const template = templateId ? await lockAuthorTemplate(tx, String(templateId)) : null;
      const ownerOrganizationId = template?.organizationId ?? organizationId;
      if (!ownerOrganizationId) return;
      if (!template) await lockOrganizationStanding(tx, { organizationId: ownerOrganizationId });
      await assertTemplateAuthor(tx, { userId: request.actor.userId, templateId: template?.id ?? '', isAdminOnly: !template });
      const current = await tx.user.findUniqueOrThrow({ where: { id: request.actor.userId }, select: { platformRole: true } });
      await resolveOrganizationContext(tx, { userId: request.actor.userId, platformRole: current.platformRole,
        selector, routeOrganizationId: ownerOrganizationId, mode: 'required', platformPermission: 'template:author' });
    });
    return next.handle();
  }
}
