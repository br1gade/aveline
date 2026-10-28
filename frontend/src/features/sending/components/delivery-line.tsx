import { Icon } from '@/ui';

import type { DeliveryText } from '../delivery-text';

/**
 * A household's invitation on the guest list (design PD-48). No hooks: the list draws one per
 * household, and the words were worked out once (`useDeliveryTexts`). Something to act on carries
 * an icon as well as words, never colour alone.
 */
export function DeliveryLine({ text, label }: { text: DeliveryText; label: string }) {
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <p className="m-0 flex items-start gap-1.5">
        {text.isAttention ? (
          <Icon name="circle-alert" size={16} className="text-destructive mt-0.5 flex-none" />
        ) : null}
        <span>
          <span className="font-medium">{label}</span> {text.summary}
        </span>
      </p>
      {text.english ? (
        <p lang="en" className="text-muted-foreground m-0 break-words">
          {text.english}
        </p>
      ) : null}
      {text.action ? <p className="text-muted-foreground m-0">{text.action}</p> : null}
    </div>
  );
}
