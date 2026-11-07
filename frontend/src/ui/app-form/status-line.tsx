import type { RefObject } from 'react';

/**
 * What an action did, said once the reloaded page is on screen. It takes the focus then
 * (`usePageStatus`), so a screen reader hears it and a keyboard continues from it.
 */
export function StatusLine({
  statusRef,
  children,
}: {
  statusRef: RefObject<HTMLParagraphElement | null>;
  children: string;
}) {
  return (
    <p ref={statusRef} role="status" tabIndex={-1} className="m-0 text-sm font-medium outline-none">
      {children}
    </p>
  );
}
