import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Gives every request an id, honouring one supplied upstream so a trace
 * survives a proxy or a call from another service.
 *
 * A payment spanning the API, a bank and a reconciliation sweep is otherwise
 * impossible to follow through the logs.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { requestId?: string }, res: Response, next: NextFunction): void {
    const supplied = req.headers['x-request-id'];
    const requestId = typeof supplied === 'string' && supplied.length <= 100 ? supplied : randomUUID();

    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  }
}
