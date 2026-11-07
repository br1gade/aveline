import type { ReactNode } from 'react';

import { FooterMark } from '@/features/invitation-renderer';

/**
 * The frame of the buyer's pages: the event, checkout and the order (design PD-78). The guest
 * pages' Ivory system, not the app's kit: a single column, mobile first (C-8), and the Aveline
 * mark once, at the foot (C-12).
 */
export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <div data-theme="ivory" className="bg-surface text-text flex min-h-svh flex-col">
      <main className="mx-auto flex w-full max-w-[40rem] flex-auto flex-col gap-10 px-5 pt-8 pb-16 sm:px-8">
        {children}
      </main>
      <FooterMark />
    </div>
  );
}
