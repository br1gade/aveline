import { PassThrough } from 'node:stream';

import { createReadableStreamFromReadable } from '@react-router/node';
import { isbot } from 'isbot';
import { renderToPipeableStream, type RenderToPipeableStreamOptions } from 'react-dom/server';
import {
  ServerRouter,
  type EntryContext,
  type HandleDataRequestFunction,
  type RouterContextProvider,
} from 'react-router';

import { readPublicEnv } from '@/config/env';
import { isCapabilityPath, redactText } from '@/lib/capability-links';
import { applySecurityHeaders, capabilityPageHeaders, createNonce } from '@/lib/security/headers';

/**
 * React Router's default Node entry, plus the security headers of setup proposal §5.11. The nonce
 * comes from the root loader so the policy and the script tags share it.
 */
export const streamTimeout = 5_000;

/**
 * A capability page keeps its referrer, cache and robots rules on every response, the error
 * boundary's included: when a loader fails, React Router skips the route's own `headers`.
 */
function protectCapabilityPage(request: Request, headers: Headers): void {
  if (isCapabilityPath(new URL(request.url).pathname)) {
    for (const [name, value] of Object.entries(capabilityPageHeaders())) {
      headers.set(name, value);
    }
  }
}

/** Client navigations fetch loader data from the same capability URL, with `.data` appended. */
export const handleDataRequest: HandleDataRequestFunction = (response, { request }) => {
  protectCapabilityPage(request, response.headers);
  return response;
};

function nonceFrom(routerContext: EntryContext): string {
  const root: unknown = routerContext.staticHandlerContext.loaderData.root;
  if (
    typeof root === 'object' &&
    root !== null &&
    'nonce' in root &&
    typeof root.nonce === 'string'
  ) {
    return root.nonce;
  }
  return createNonce();
}

interface RenderInput {
  request: Request;
  status: number;
  headers: Headers;
  routerContext: EntryContext;
  nonce: string;
}

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  const nonce = nonceFrom(routerContext);
  const env = readPublicEnv();
  protectCapabilityPage(request, responseHeaders);
  applySecurityHeaders(responseHeaders, {
    nonce,
    isProduction: import.meta.env.PROD,
    mediaOrigin: env.VITE_MEDIA_BASE_URL,
    apiOrigin: env.VITE_API_BASE_URL,
  });

  if (request.method.toUpperCase() === 'HEAD') {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }
  return renderDocument({
    request,
    status: responseStatusCode,
    headers: responseHeaders,
    routerContext,
    nonce,
  });
}

function renderDocument(input: RenderInput): Promise<Response> {
  const { request, headers, routerContext, nonce } = input;
  return new Promise<Response>((resolve, reject) => {
    let status = input.status;
    let isShellRendered = false;
    const userAgent = request.headers.get('user-agent');
    // Crawlers and link-preview bots get the complete page in one piece.
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? 'onAllReady' : 'onShellReady';

    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => abort(),
      streamTimeout + 1000,
    );

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
      {
        nonce,
        [readyOption]() {
          isShellRendered = true;
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          headers.set('Content-Type', 'text/html');
          pipe(body);
          resolve(new Response(createReadableStreamFromReadable(body), { headers, status }));
        },
        onShellError(error: unknown) {
          reject(error instanceof Error ? error : new Error(String(error)));
        },
        onError(error: unknown) {
          status = 500;
          if (isShellRendered) {
            // A guest page's URL is its credential; an error can quote it (root CLAUDE.md §3).
            console.error(
              redactText(error instanceof Error ? (error.stack ?? error.message) : String(error)),
            );
          }
        },
      },
    );
  });
}
