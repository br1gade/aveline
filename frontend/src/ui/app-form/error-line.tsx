import type { ReactNode } from 'react';

import { cx, Icon } from '@/ui';

interface ErrorLineProps {
  /** A field's error, named by its input's `aria-describedby`. */
  id?: string | undefined;
  /** A refusal or a failure of its own, announced as it appears. */
  role?: 'alert' | undefined;
  className?: string | undefined;
  children: ReactNode;
}

/** An error in the app: an icon and words, never colour alone (frontend CLAUDE.md §5, audit F-19). */
export function ErrorLine({ id, role, className, children }: ErrorLineProps) {
  return (
    <p
      id={id}
      role={role}
      className={cx('text-destructive m-0 flex items-start gap-1.5 text-sm', className)}
    >
      <Icon name="circle-alert" size={16} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
