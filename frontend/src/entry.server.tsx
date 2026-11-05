import { PassThrough } from 'node:stream';

import { createReadableStreamFromReadable } from '@react-router/node';
import { isbot } from 'isbot';
import { renderToPipeableStream, type RenderToPipeableStreamOptions } from 'react-dom/server';
import {
  isRouteErrorResponse,
  matchPath,
  ServerRouter,
  type EntryContext,
  type HandleDataRequestFunction,
  type HandleErrorFunction,
  type RouterContextProvider,
} from 'react-router';

import { readPublicEnv } from '@/config/env';
import { carriesCapability, redactText } from '@/lib/capability-links';
import { applySecurityHeaders, capabilityPageHeaders, createNonce } from '@/lib/security/headers';
import { APP_PATHS, ROUTE_PATHS } from '@/route-paths';

/**
 * React Router's default Node entry, plus the security headers of setup proposal §5.11. The nonce
 * comes from the root loader so the policy and the script tags share it.
 */
export const streamTimeout = 5_000;

/** The router's own 4xx keeps the error it stands for, undeclared in its type. */
function internalError(response: object): unknown {
  return 'error' in response ? response.error : undefined;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return redactText(error.stack ?? error.message);
  if (isRouteErrorResponse(error)) return `${String(error.status)} ${error.statusText}`;
  return redactText(String(error));
}

/**
 * Replaces React Router's own logging, which prints a loader's error whole: a guest page's address
 * is its credential, and an error can quote it (root CLAUDE.md §3).
 */
export const handleError: HandleErrorFunction = (error, { request }) => {
  if (request.signal.aborted) return;
  console.error(errorText(isRouteErrorResponse(error) ? (internalError(error) ?? error) : error));
};

/**
 * Pages that show what a capability link opened without the token in their own address: the
 * buyer's order, read with the token the tab holds (design PD-81), and a vendor's brief (PD-124).
 * The bank's return for a plan names its order number in the query until the page removes it
 * (PD-130), so its address is kept the same way.
 */
const SHOWS_A_CAPABILITY: ReadonlySet<string> = new Set([
  APP_PATHS.ticketOrder,
  APP_PATHS.briefPage,
  ROUTE_PATHS.billingPaymentReturn,
]);

/** The router matches whatever the case and with a trailing slash, so these rules must too. */
function isCapabilityPage(address: URL): boolean {
  const url = new URL(address);
  url.pathname = url.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  return carriesCapability(url) || SHOWS_A_CAPABILITY.has(url.pathname.replace(/\.data$/, ''));
}

/**
 * The designer's draft preview is drawn in a frame on the section page, at a phone's width (design
 * PD-153), so the app itself may frame it; no other page may be framed by anyone.
 */
function framingOf(address: URL): 'none' | 'self' {
  return matchPath(APP_PATHS.designDraftPreview, address.pathname.replace(/\/+$/, ''))
    ? 'self'
    : 'none';
}

/**
 * A capability page keeps its referrer, cache and robots rules on every response, the error
 * boundary's included: when a loader fails, React Router skips the route's own `headers`.
 */
function protectCapabilityPage(request: Request, headers: Headers): void {
  if (isCapabilityPage(new URL(request.url))) {
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
    framing: framingOf(new URL(request.url)),
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
            console.error(errorText(error));
          }
        },
      },
    );
  });
}
