import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpException, RawBodyRequest } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { WHATSAPP_BODY_LIMIT } from './whatsapp-auth';

/** Install before Nest's default parser; other endpoints keep their smaller limit. */
export function configureWhatsAppBodyParser(app: NestExpressApplication): void {
  const parse = json({
    limit: WHATSAPP_BODY_LIMIT,
    inflate: false,
    verify: (request: RawBodyRequest<IncomingMessage>, _response, body) => { request.rawBody = body; },
  });
  // Nest detects existing parsers by function name, even when route-scoped.
  // A wrapper keeps this parser from suppressing JSON parsing everywhere else.
  const parseWhatsAppJson: RequestHandler = (request, response, next) => parse(request, response, next);
  app.use('/api/v1/communications/whatsapp-webhook', parseWhatsAppJson, reportParserError);
}

// Body-parser's errors are Express errors, which our Nest filter otherwise treats as 500s.
const reportParserError: ErrorRequestHandler = (error: unknown, _request, _response, next) => {
  if (error && typeof error === 'object' && 'status' in error && [400, 413, 415].includes(Number(error.status))) {
    next(new HttpException('Invalid WhatsApp JSON body, encoding or size (maximum 3 MiB)', Number(error.status)));
    return;
  }
  next(error);
};
