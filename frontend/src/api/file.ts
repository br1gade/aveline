import { apiErrorFrom, networkError } from './errors';

/**
 * A file the signed-in client fetched with its bearer token (docs/API.md §6, "Exports"): there is
 * no public link to it. The bytes are handed to the browser from an object URL (`ui/save-file.ts`).
 */
export interface FetchedFile {
  blob: Blob;
  /** The response's `Content-Type`, or the blob's own when the header is absent. */
  contentType: string;
  /** From `Content-Disposition`, which the backend still hides cross-origin (FR-10). */
  filename: string | undefined;
}

interface FileResult {
  data?: unknown;
  error?: unknown;
  response: Response;
}

/** The last segment of a name, so a server-sent path cannot point a save anywhere. */
function baseName(name: string): string | undefined {
  const last = name.split(/[\\/]/).pop()?.trim();
  return last ? last : undefined;
}

/** RFC 5987's `filename*=UTF-8''…`, which carries names outside ASCII. */
function extendedName(header: string): string | undefined {
  const match = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(header);
  if (!match?.[1]) return undefined;
  try {
    return baseName(decodeURIComponent(match[1].trim()));
  } catch {
    return undefined;
  }
}

/** `filename="…"`, with its escapes, or a bare `filename=…`. */
function plainName(header: string): string | undefined {
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header);
  if (quoted) return baseName((quoted[1] ?? '').replace(/\\(.)/g, '$1'));
  const bare = /filename\s*=\s*([^;\s]+)/i.exec(header);
  return bare?.[1] ? baseName(bare[1]) : undefined;
}

/** The name a `Content-Disposition` header gives; the extended form wins, as RFC 6266 says. */
export function filenameFromDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  if (/filename\*\s*=/i.test(header)) return extendedName(header);
  return plainName(header);
}

/** As `expectData`, for a call made with `parseAs: 'blob'`: the bytes, their type and name. */
export async function expectFile(
  call: Promise<FileResult>,
  requestId?: string,
): Promise<FetchedFile> {
  let result: FileResult;
  try {
    result = await call;
  } catch {
    throw networkError(requestId);
  }
  const { response } = result;
  if (!response.ok) {
    throw apiErrorFrom(response, result.error, requestId);
  }
  const blob = result.data as Blob;
  return {
    blob,
    contentType: response.headers.get('content-type') ?? blob.type,
    filename: filenameFromDisposition(response.headers.get('content-disposition')),
  };
}
