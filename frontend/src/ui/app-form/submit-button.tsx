import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsHydrated } from '@/ui';
import { cn } from '@/ui/cn';
import { Button } from '@/ui/kit/button';

interface SubmitButtonProps {
  isSubmitting: boolean;
  children: ReactNode;
  className?: string;
  /**
   * Says "Working…" while sending, for a form whose label doesn't change by itself: a button that
   * only greys out looks dead (audit F-41). Forms with their own "Saving…" leave it off.
   */
  saysWorking?: boolean;
  /** Not pressable yet for a reason the form shows beside it, such as no file chosen. */
  isUnavailable?: boolean;
}

/**
 * Disabled until the page is hydrated (design PD-41), and while sending. A disabled default button
 * also stops Enter from submitting, so nothing typed reaches the address bar before JavaScript runs.
 */
export function SubmitButton({
  isSubmitting,
  children,
  className,
  saysWorking = false,
  isUnavailable = false,
}: SubmitButtonProps) {
  const { t } = useTranslation('common');
  const isHydrated = useIsHydrated();
  return (
    <Button
      type="submit"
      disabled={!isHydrated || isSubmitting || isUnavailable}
      aria-busy={isSubmitting || undefined}
      className={cn('w-full', className)}
    >
      {isSubmitting && saysWorking ? t('dialog.working') : children}
    </Button>
  );
}
