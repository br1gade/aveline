import { Button } from '@/ui/kit/button';

import { WRAPPING_BUTTON } from './wrapping';
import { ErrorLine } from './error-line';

/** "Show more", or the first press of a list read on request, with what went wrong under it. */
export function MoreButton({
  label,
  failed,
  isLoading,
  hasFailed,
  onPress,
}: {
  label: string;
  failed: string;
  isLoading: boolean;
  hasFailed: boolean;
  onPress: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="outline" className={WRAPPING_BUTTON} disabled={isLoading} onClick={onPress}>
        {label}
      </Button>
      {hasFailed ? <ErrorLine role="alert">{failed}</ErrorLine> : null}
    </div>
  );
}
