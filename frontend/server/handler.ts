import { createReadStream } from 'node:fs';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream';

import { canReachRouter, loggedError, requestLine } from './log.ts';
import { staticFile } from './static.ts';

export interface HandlerParts {
  /** The client's build, whose files are served as they are. */
  client: string;
  renderPage: RequestListener;
  log: (line: string) => void;
  logError: (line: string) => void;
}

async function sendStatic(
  request: IncomingMessage,
  response: ServerResponse,
  { client, logError }: HandlerParts,
): Promise<boolean> {
  const isRead = request.method === 'GET' || request.method === 'HEAD';
  const pathname = (request.url ?? '/').split('?', 1)[0] ?? '/';
  const file = isRead ? await staticFile(client, pathname) : null;
  if (!file) return false;
  response.writeHead(200, {
    'Content-Type': file.contentType,
    'Content-Length': file.size,
    'Cache-Control': file.cacheControl,
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') {
    response.end();
    return true;
  }
  pipeline(createReadStream(file.path), response, (error) => {
    if (error && error.code !== 'ERR_STREAM_PREMATURE_CLOSE') logError(loggedError(error));
  });
  return true;
}

function logWhenFinished(
  request: IncomingMessage,
  response: ServerResponse,
  log: HandlerParts['log'],
): void {
  const startedAt = performance.now();
  response.once('finish', () => {
    log(
      requestLine({
        method: request.method ?? '',
        url: request.url ?? '',
        status: response.statusCode,
        ms: Math.round(performance.now() - startedAt),
      }),
    );
  });
}

/** One request: the health check, a refusal, a built file, or a page. */
export function createHandler(parts: HandlerParts) {
  const route = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      return;
    }
    logWhenFinished(request, response, parts.log);
    if (!canReachRouter(request.url ?? '/', request.headers.host)) {
      response.writeHead(400).end();
      return;
    }
    if (await sendStatic(request, response, parts)) return;
    parts.renderPage(request, response);
  };
  return (request: IncomingMessage, response: ServerResponse): Promise<void> =>
    route(request, response).catch((error: unknown) => {
      parts.logError(loggedError(error));
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
}
