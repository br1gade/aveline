import type { Ref } from 'react';

import { Icon } from '../icon';

export interface SummaryItem {
  /** The id of the field or fieldset the link moves to. */
  target: string;
  message: string;
}

interface ErrorSummaryProps {
  title: string;
  items: readonly SummaryItem[];
  ref?: Ref<HTMLDivElement>;
}

/**
 * Every problem at the top of the form, each a link to its field (DESIGN_SYSTEM §9). It takes
 * focus when a send fails. The links are 44 px tall, as fix 8 drew them.
 */
export function ErrorSummary({ title, items, ref }: ErrorSummaryProps) {
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="border-error-ink bg-error-tint text-ink grid gap-2 border px-5 py-4 focus:outline-none focus-visible:outline-2"
    >
      <h3 className="text-error-ink m-0 flex items-center gap-2 text-base leading-6 font-semibold">
        <Icon name="circle-alert" />
        {title}
      </h3>
      <ul className="m-0 grid list-disc gap-1 pl-6">
        {items.map((item) => (
          <li key={`${item.target}-${item.message}`}>
            <a
              href={`#${item.target}`}
              className="text-error-ink hover:text-error-ink-hover inline-flex min-h-(--target-min) items-center text-[15px] leading-[22px] underline underline-offset-3"
            >
              {item.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
