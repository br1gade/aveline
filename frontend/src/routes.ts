import { index, route, type RouteConfig } from '@react-router/dev/routes';

import { ROUTE_PATHS } from './route-paths';

/** React Router route paths are relative to the root. */
function relative(path: string): string {
  return path.replace(/^\//, '');
}

/**
 * The route table. Paths the backend emails come from ROUTE_PATHS, never from a literal here.
 * Route modules stay thin: loader, meta, headers, layout (frontend/CLAUDE.md §6).
 */
export default [
  index('routes/home.tsx'),
  route(relative(ROUTE_PATHS.genericInvitation), 'routes/public/invitation.tsx'),
  route(relative(ROUTE_PATHS.guestInvitation), 'routes/public/guest-invitation.tsx'),
  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig;
