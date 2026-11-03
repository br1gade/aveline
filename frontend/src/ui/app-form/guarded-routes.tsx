import { createRoutesStub, Outlet } from 'react-router';

import { LeaveGuard } from './leave-guard';

type StubRoutes = Parameters<typeof createRoutesStub>[0];

function GuardedFrame() {
  return (
    <LeaveGuard>
      <Outlet />
    </LeaveGuard>
  );
}

/** For tests: the routes inside the guard, as the app's `/app` layout puts them. */
export function guardedRoutes(routes: StubRoutes): StubRoutes {
  return [{ Component: GuardedFrame, children: routes }];
}

/** For tests: whether a reload now would ask first, so whether a guarded form has changes. */
export function isLeavingAsked(): boolean {
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  return unload.defaultPrevented;
}
