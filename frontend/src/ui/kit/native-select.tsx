import * as React from 'react';
import { cn } from '@/ui/cn';
import { Icon } from '@/ui/icon';

// shadcn/ui's native select, written by hand: the CLI would add lucide-react. A native control,
// because a list of every time zone needs the browser's own type-ahead and its phone pickers.
// The height follows the kit's input: 40 px, 44 px on touch (PD-39).
function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <div
      className="group/native-select relative w-full has-[select:disabled]:opacity-50"
      data-slot="native-select-wrapper"
    >
      <select
        data-slot="native-select"
        className={cn(
          'border-input selection:bg-primary selection:text-primary-foreground dark:bg-input/30 dark:hover:bg-input/50 h-10 w-full min-w-0 appearance-none rounded-md border bg-transparent py-1 pr-9 pl-3 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed md:text-sm pointer-coarse:h-11',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
          'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
          className,
        )}
        {...props}
      />
      <span
        data-slot="native-select-icon"
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 select-none"
      >
        <Icon name="chevron-down" size={16} />
      </span>
    </div>
  );
}

function NativeSelectOption(props: React.ComponentProps<'option'>) {
  return <option data-slot="native-select-option" {...props} />;
}

export { NativeSelect, NativeSelectOption };
