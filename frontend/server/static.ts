import { realpath, stat } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';

/** The types the build writes. Anything else is bytes: `nosniff` keeps it from being run. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const HASHED_ASSETS = '/assets/';
const FOR_A_YEAR = 'public, max-age=31536000, immutable';
const FOR_AN_HOUR = 'public, max-age=3600';

export interface StaticFile {
  path: string;
  size: number;
  contentType: string;
  cacheControl: string;
}

function decoded(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

/** No parent folders, hidden folders or null bytes: nothing outside what the build published. */
function isPublicPath(path: string): boolean {
  return !path.includes('\0') && !path.split(/[/\\]/).some((part) => part.startsWith('.'));
}

async function fileInside(root: string, path: string): Promise<string | null> {
  try {
    const [realRoot, real] = await Promise.all([realpath(root), realpath(join(root, path))]);
    return real.startsWith(realRoot + sep) && (await stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}

/**
 * A file of the client's build, or `null` to leave the address to the router. Only an address with
 * an extension is looked for: a page's never needs the disk, and a token never reaches it.
 */
export async function staticFile(root: string, pathname: string): Promise<StaticFile | null> {
  const path = decoded(pathname);
  if (!path || !extname(path) || !isPublicPath(path)) return null;
  const file = await fileInside(root, path);
  if (!file) return null;
  return {
    path: file,
    size: (await stat(file)).size,
    contentType: CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    cacheControl: path.startsWith(HASHED_ASSETS) ? FOR_A_YEAR : FOR_AN_HOUR,
  };
}
