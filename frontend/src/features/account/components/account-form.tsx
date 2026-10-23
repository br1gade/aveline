import type { FormEventHandler, ReactNode } from 'react';

import { cn } from '@/ui/cn';

interface AccountFormProps {
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
  className?: string;
}

/**
 * The account forms submit from JavaScript. `method="post"` is the guard for the moment before
 * hydration: were the browser to submit the form itself, the fields would go in a request body,
 * never into the address bar, history or a log. `SubmitButton` stays disabled until then anyway.
 */
export function AccountForm({ onSubmit, children, className }: AccountFormProps) {
  return (
    <form
      method="post"
      noValidate
      onSubmit={onSubmit}
      className={cn('flex flex-col gap-4', className)}
    >
      {children}
    </form>
  );
}
