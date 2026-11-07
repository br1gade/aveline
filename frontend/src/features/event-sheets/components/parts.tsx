import { useId, type ReactNode } from 'react';

import { Link } from 'react-router';

import type { Loaded } from '@/api/loaded';
import { LoadedProblem } from '@/features/sending';

export const LINK =
  'text-primary inline-flex min-h-11 items-center underline underline-offset-4 hover:no-underline';

export function Sheet({
  title,
  note,
  lang,
  children,
}: {
  title: string;
  note?: string;
  /** The title's language, when it is the event's words rather than the app's. */
  lang?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="border-border flex flex-col gap-3 border p-4">
      <h2 id={id} lang={lang} className="m-0 text-lg font-medium">
        {title}
      </h2>
      {note ? <p className="text-muted-foreground m-0 text-sm">{note}</p> : null}
      {children}
    </section>
  );
}

/**
 * Counted rows, the label first, so a long one wraps rather than pushes the number away. The labels
 * may be the event's words (`labelLang`) while the counts are the app's.
 */
export function Rows({
  rows,
  labelLang,
}: {
  rows: readonly { label: string; value: string }[];
  labelLang?: string;
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {rows.map(({ label, value }, position) => (
        <li key={position} className="flex justify-between gap-3">
          <span lang={labelLang} className="min-w-0 break-words">
            {label}
          </span>
          <span className="flex-none font-medium">{value}</span>
        </li>
      ))}
    </ul>
  );
}

export function PartOf<T>({
  read,
  refused,
  children,
}: {
  read: Loaded<T>;
  refused: string;
  children: (value: T) => ReactNode;
}) {
  return read.kind === 'ready' ? (
    children(read.value)
  ) : (
    <LoadedProblem loaded={read} refusedText={refused} />
  );
}

/** The way back, the page's name and the event it is about, as each sheet page opens. */
export function SheetHeader({
  back,
  backTo,
  title,
  subject,
}: {
  back: string;
  backTo: string;
  title: string;
  subject: string;
}) {
  return (
    <>
      <Link to={backTo} className={`${LINK} self-start`}>
        {back}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{title}</h1>
        <p className="text-muted-foreground m-0 break-words">{subject}</p>
      </div>
    </>
  );
}
