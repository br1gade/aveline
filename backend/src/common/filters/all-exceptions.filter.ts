import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Sentry } from '../../infra/observability/sentry';
import type { Request, Response } from 'express';

/**
 * One error shape for every failure, and one place that decides what a client
 * is told.
 *
 * Two things this exists to prevent: a Prisma error reaching a client as a
 * 500 with a stack trace naming our tables, and the same failure being logged
 * five different ways. Every response carries the request id so a user's
 * screenshot maps to a log line.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request & { requestId?: string }>();

    const { status, message } = this.describe(exception);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status} [${request.requestId ?? '-'}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );

      // Only ours. A 404 or a failed validation is the caller's mistake, and
      // reporting those would bury the incidents that matter under noise.
      Sentry.captureException(exception, {
        tags: { requestId: request.requestId ?? 'unknown' },
      });
    }

    response.status(status).json({
      statusCode: status,
      message,
      requestId: request.requestId,
      path: request.url,
      at: new Date().toISOString(),
    });
  }

  private describe(exception: unknown): { status: number; message: unknown } {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const message =
        typeof body === 'object' && body !== null && 'message' in body ? body.message : body;
      return { status: exception.getStatus(), message };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.describePrisma(exception);
    }

    // Anything unrecognised is reported without detail: an internal message
    // may name tables, columns or configuration.
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
  }

  /** Maps the Prisma errors that correspond to a client mistake. */
  private describePrisma(error: Prisma.PrismaClientKnownRequestError) {
    const byCode: Record<string, { status: number; message: string }> = {
      P2002: { status: HttpStatus.CONFLICT, message: 'That value is already taken' },
      P2003: { status: HttpStatus.BAD_REQUEST, message: 'Referenced record does not exist' },
      P2025: { status: HttpStatus.NOT_FOUND, message: 'Record not found' },
    };

    return (
      byCode[error.code] ?? {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      }
    );
  }
}
