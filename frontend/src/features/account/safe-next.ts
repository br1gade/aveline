import { APP_PATHS } from '@/route-paths';

/**
 * Where to go after signing in. `?next=` comes from the address bar, so only a path inside the app
 * is followed: anything else, another site above all, goes to the app's home.
 */
export function safeNext(next: string | null): string {
  if (!next || next.includes('\\') || next.startsWith('//')) {
    return APP_PATHS.app;
  }
  const isInsideApp =
    next === APP_PATHS.app ||
    next.startsWith(`${APP_PATHS.app}/`) ||
    next.startsWith(`${APP_PATHS.app}?`);
  return isInsideApp ? next : APP_PATHS.app;
}
