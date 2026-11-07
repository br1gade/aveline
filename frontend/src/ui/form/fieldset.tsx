import type { ReactNode } from 'react';

import { cx } from '../cx';
import { Icon } from '../icon';

interface FieldsetProps {
  legend: ReactNode;
  /** "Required" or "Optional", in words: never by colour alone (spec §6.1g). */
  marker?: string | undefined;
  error?: string | undefined;
  /** For the error summary's link. */
  id?: string | undefined;
  children: ReactNode;
  className?: string;
}

/** A question: a fieldset with its legend in `heading-3` (spec §11). */
export function Fieldset({ legend, marker, error, id, children, className }: FieldsetProps) {
  const errorId = id ? `${id}-error` : undefined;
  return (
    <fieldset
      id={id}
      tabIndex={id ? -1 : undefined}
      aria-describedby={error ? errorId : undefined}
      className={cx(
        'm-0 flex min-w-0 scroll-mt-6 flex-col gap-3 border-0 p-0 focus:outline-none',
        className,
      )}
    >
      <legend className="type-heading-3 text-ink mb-1 p-0">
        {legend}
        {marker ? (
          <span className="text-ink-muted font-sans text-sm font-normal"> · {marker}</span>
        ) : null}
      </legend>
      {error ? (
        <p id={errorId} className="text-error m-0 flex items-start gap-2 text-sm leading-5">
          <Icon name="circle-alert" size={18} className="mt-px" />
          {error}
        </p>
      ) : null}
      {children}
    </fieldset>
  );
}
