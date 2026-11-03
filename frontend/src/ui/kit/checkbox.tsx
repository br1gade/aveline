import * as React from 'react';
import { cn } from '@/ui/cn';
import { Icon } from '@/ui/icon';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';

// shadcn/ui's checkbox, written by hand: the CLI would add lucide-react, and the check comes from
// our own icons instead (docs/ARCHITECTURE.md §8). Square, as every kit corner (PD-39). The box is
// 16 px, and an unseen 44 px area around it takes the press (frontend/CLAUDE.md §5).
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive relative size-4 shrink-0 rounded-sm border shadow-xs transition-shadow outline-none before:absolute before:top-1/2 before:left-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <Icon name="check" size={16} className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
