import type { FormEventHandler, ReactNode } from 'react';

import { cn } from '../cn';

interface AppFormProps {
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
  className?: string;
}

/**
 * The account and app forms submit from JavaScript. `method="post"` is the guard for the moment
 * before hydration: were the browser to submit the form itself, the fields would go in a request
 * body, never into the address bar, history or a log. `SubmitButton` stays disabled until then
 * anyway (design PD-41).
 */
export function AppForm({ onSubmit, children, className }: AppFormProps) {
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
