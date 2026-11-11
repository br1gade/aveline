import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { Granted, Permission } from '../types';

const GrantedContext = createContext<ReadonlySet<Permission> | null>(null);

/** The permissions a layout read, for every page under it. The nearest layout's read wins. */
export function GrantedPermissions({
  permissions,
  children,
}: {
  permissions: Granted;
  children: ReactNode;
}) {
  const granted = useMemo(() => (permissions ? new Set(permissions) : null), [permissions]);
  return <GrantedContext.Provider value={granted}>{children}</GrantedContext.Provider>;
}

/**
 * Whether to offer an action (FR-6, design PD-190): one the caller can never take is not offered.
 * While nothing is known every action is offered, and its own 403 is worded, as for a role that
 * changes mid-visit. The server still decides every write.
 */
export function useCan(permission: Permission): boolean {
  const granted = useContext(GrantedContext);
  return granted === null || granted.has(permission);
}

/** Its children, only for a caller who may take the action they offer. */
export function Permitted({ to, children }: { to: Permission; children: ReactNode }) {
  return useCan(to) ? children : null;
}

/**
 * What a caller may read but not change (design PD-193): shown whole, every control in it switched
 * off, under one line that says so. While nothing is known it is offered as for any role.
 */
export function ChangeableWith({
  to,
  readOnly,
  children,
}: {
  to: Permission;
  /** The line saying the role can see this but not change it. */
  readOnly: string;
  children: ReactNode;
}) {
  if (useCan(to)) return children;
  return (
    <>
      <p className="m-0">{readOnly}</p>
      <fieldset disabled className="contents">
        {children}
      </fieldset>
    </>
  );
}
