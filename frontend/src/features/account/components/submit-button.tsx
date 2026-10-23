import type { ReactNode } from 'react';

import { useIsHydrated } from '@/ui';
import { cn } from '@/ui/cn';
import { Button } from '@/ui/kit/button';

interface SubmitButtonProps {
  isSubmitting: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Disabled until the page is hydrated (design PD-41), and while sending. A disabled default button
 * also stops Enter from submitting, so nothing typed reaches the address bar before JavaScript runs.
 */
export function SubmitButton({ isSubmitting, children, className }: SubmitButtonProps) {
  const isHydrated = useIsHydrated();
  return (
    <Button
      type="submit"
      disabled={!isHydrated || isSubmitting}
      className={cn('w-full', className)}
    >
      {children}
    </Button>
  );
}
