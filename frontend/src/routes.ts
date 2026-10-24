import { index, layout, route, type RouteConfig } from '@react-router/dev/routes';

import { APP_PATHS, ROUTE_PATHS } from './route-paths';

/** React Router route paths are relative to the root. */
function relative(path: string): string {
  return path.replace(/^\//, '');
}

/** A child of `/app`, relative to it. */
function underApp(path: string): string {
  return path.replace(`${APP_PATHS.app}/`, '');
}

/**
 * The route table. Paths the backend builds come from ROUTE_PATHS, the client's own from
 * APP_PATHS, never from a literal here. Route modules stay thin: loader, meta, headers, layout
 * (frontend/CLAUDE.md §6).
 */
export default [
  index('routes/home.tsx'),
  route(relative(ROUTE_PATHS.genericInvitation), 'routes/public/invitation.tsx'),
  route(relative(ROUTE_PATHS.guestInvitation), 'routes/public/guest-invitation.tsx'),

  route(relative(ROUTE_PATHS.signIn), 'routes/account/sign-in.tsx'),
  route(relative(APP_PATHS.register), 'routes/account/register.tsx'),
  route(relative(ROUTE_PATHS.resetPassword), 'routes/account/reset-password.tsx'),
  route(relative(ROUTE_PATHS.verifyEmail), 'routes/account/verify-email.tsx'),
  route(relative(ROUTE_PATHS.acceptInvite), 'routes/account/accept-invite.tsx'),
  route(relative(ROUTE_PATHS.acceptEventInvite), 'routes/account/accept-event-invite.tsx'),

  // The language comes from the segment; the session check, from the layout under it.
  route(relative(APP_PATHS.app), 'routes/app/route.tsx', [
    layout('routes/app/layout.tsx', [
      index('routes/app/home.tsx'),
      route(underApp(APP_PATHS.welcome), 'routes/app/welcome.tsx'),
      route(underApp(APP_PATHS.newEvent), 'routes/app/new-event.tsx'),
      route(underApp(APP_PATHS.event), 'routes/app/event.tsx'),
      route(underApp(APP_PATHS.editEvent), 'routes/app/event-edit.tsx'),
    ]),
  ]),

  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig;
