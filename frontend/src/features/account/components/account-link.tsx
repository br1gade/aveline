import type { ReactNode } from 'react';
import { Link } from 'react-router';

/** A link between the account pages. `reloadDocument` starts the page afresh, token state and all. */
export function AccountLink({
  to,
  children,
  reloadDocument = false,
}: {
  to: string;
  children: ReactNode;
  reloadDocument?: boolean;
}) {
  return (
    <Link
      to={to}
      reloadDocument={reloadDocument}
      className="text-primary underline underline-offset-4 hover:no-underline"
    >
      {children}
    </Link>
  );
}
