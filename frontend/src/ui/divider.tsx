import { cx } from './cx';

/** A hairline, a lozenge, a hairline, in `ornament`. Decoration: at most twice a page. */
export function Divider({ isLong = false, className }: { isLong?: boolean; className?: string }) {
  const rule = cx('h-px bg-ornament', isLong ? 'w-24' : 'w-12');
  return (
    <div aria-hidden="true" className={cx('flex items-center justify-center gap-3', className)}>
      <span className={rule} />
      <Lozenge />
      <span className={rule} />
    </div>
  );
}

export function Lozenge({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx('bg-ornament size-1.5 flex-none rotate-45', className)}
    />
  );
}
