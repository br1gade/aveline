import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { requestLanguage } from './localized-feedback';

/**
 * The language the caller reads: `?locale=`, else `Accept-Language`, else
 * English. For mail a request causes and no event's language governs —
 * account mail and team invitations (audit F-08).
 */
export const RequestLanguage = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => requestLanguage(context.switchToHttp().getRequest()),
);
