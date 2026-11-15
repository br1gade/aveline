import type { ReactNode } from 'react';

import { cx } from '../cx';
import { Icon } from '../icon';

interface ErrorTextProps {
  /** A field's error, named by its input's `aria-describedby`. */
  id?: string | undefined;
  /** A refusal or a failure of its own, announced as it appears. */
  role?: 'alert' | undefined;
  className?: string | undefined;
  children: ReactNode;
}

/**
 * An error on the guest pages, in their Ivory look: an icon and words, never colour alone
 * (DESIGN_SYSTEM "Accessibility", audit F-19).
 */
export function ErrorText({ id, role, className, children }: ErrorTextProps) {
  return (
    <p
      id={id}
      role={role}
      className={cx('text-error m-0 flex items-start gap-2 text-sm leading-5', className)}
    >
      <Icon name="circle-alert" size={18} className="mt-px shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
