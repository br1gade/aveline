import type { ReactNode, Ref } from 'react';

import { cx } from './cx';
import { Icon, type IconName } from './icon';

export type NoticeTone = 'info' | 'success' | 'error';

const TONES: Record<NoticeTone, { box: string; icon: string; name: IconName }> = {
  info: { box: 'border-control-edge bg-surface-sunken text-text', icon: '', name: 'info' },
  success: {
    box: 'border-success-ink bg-success-tint text-ink',
    icon: 'text-success-ink',
    name: 'circle-check',
  },
  error: {
    box: 'border-error-ink bg-error-tint text-ink',
    icon: 'text-error-ink',
    name: 'circle-alert',
  },
};

interface NoticeProps {
  tone?: NoticeTone;
  children: ReactNode;
  /** One action, where it helps: "Try again". */
  action?: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
  role?: 'status' | 'alert';
}

/** A short message about the page's state, with a full border and words beside the colour. */
export function Notice({ tone = 'info', children, action, className, ref, role }: NoticeProps) {
  const look = TONES[tone];
  return (
    <div
      ref={ref}
      role={role}
      className={cx(
        'flex items-start gap-3 border px-5 py-4 text-[15px] leading-[22px]',
        look.box,
        className,
      )}
    >
      <Icon name={look.name} className={cx('mt-px', look.icon)} />
      <div className="flex min-w-0 flex-col gap-3">
        <div className="[&_p]:m-0">{children}</div>
        {action}
      </div>
    </div>
  );
}
