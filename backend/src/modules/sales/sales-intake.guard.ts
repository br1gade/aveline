import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedRequest } from '../../infra/auth/actor';
import { assertIntakeEnabled } from './enquiry-config';

@Injectable()
export class SalesIntakeGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    assertIntakeEnabled(this.config);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.actor?.platformRole === 'SUPPORT' && this.config.get<string>('SALES_INTAKE_SUPPORT_ENABLED') !== 'true') throw new ForbiddenException('Staff intake support is not enabled');
    return true;
  }
}
