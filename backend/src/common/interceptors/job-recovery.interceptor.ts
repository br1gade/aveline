import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { map } from 'rxjs';
import { localizeFailure, requestLanguage } from '../localized-feedback';
import type { Request } from 'express';
import { localizeSeatingResult } from '../localized-seating';

/** Adds display copy to job summaries; machine failure reasons remain stable. */
@Injectable()
export class JobRecoveryInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const locale = requestLanguage(context.switchToHttp().getRequest<Request>());
    return next.handle().pipe(map((value: unknown) => describeJobRecovery(value, locale)));
  }
}

export function describeJobRecovery(value: unknown, locale: string): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => describeJobRecovery(item, locale));
  if (!value || typeof value !== 'object' || value instanceof StreamableFile) return value;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.items)) return { ...record, items: describeJobRecovery(record.items, locale) };
  if (Array.isArray(record.signatureUploads)) return { ...record, signatureUploads: describeJobRecovery(record.signatureUploads, locale) };
  if (!Object.hasOwn(record, 'failureReason')) return value;
  return describeSummary(record, locale);
}

function describeSummary(record: Record<string, unknown>, locale: string) {
  const result: Record<string, unknown> = { ...record, recovery: localizeFailure(record.failureReason, locale, record.status ?? record.processingStatus) };
  if (Object.hasOwn(record, 'result')) result.result = localizeSeatingResult(record.result, locale);
  return result;
}
