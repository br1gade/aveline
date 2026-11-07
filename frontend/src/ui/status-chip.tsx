import type { ReactNode } from 'react';

import { cx } from './cx';

export type ReplyStatus = 'ATTENDING' | 'DECLINED' | 'UNDECIDED';

const MARKS: Record<ReplyStatus, string> = {
  ATTENDING: 'size-2 bg-success',
  DECLINED: 'h-0.5 w-2 bg-text-muted',
  UNDECIDED: 'size-2 border border-text-muted',
};

/**
 * The guest's reply in a few words. The words carry the meaning; the mark (filled, a dash,
 * hollow) only helps scanning, so colour never stands alone.
 */
export function StatusChip({
  status,
  children,
  className,
}: {
  status: ReplyStatus;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-2 text-[12px] leading-4 font-medium tracking-[0.12em] uppercase',
        className,
      )}
    >
      <span aria-hidden="true" className={cx('flex-none', MARKS[status])} />
      <span>{children}</span>
    </span>
  );
}
