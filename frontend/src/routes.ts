import { index, route, type RouteConfig } from '@react-router/dev/routes';

/**
 * The route table. Paths the backend emails come from ROUTE_PATHS, never from a literal here.
 * Route modules stay thin: loader, meta, headers, layout (frontend/CLAUDE.md §6).
 */
export default [index('routes/home.tsx'), route('*', 'routes/not-found.tsx')] satisfies RouteConfig;
