import { useTranslation } from 'react-i18next';

import { Label } from '@/ui/kit/label';
import { RadioGroup, RadioGroupItem } from '@/ui/kit/radio-group';

import { REPLIES, type Reply } from '../types';

function isReply(value: string): value is Reply {
  return (REPLIES as readonly string[]).includes(value);
}

interface ReplyChoicesProps {
  idPrefix: string;
  labelledBy: string;
  value: Reply | '';
  onChange: (reply: Reply) => void;
  describedBy?: string | undefined;
}

/** Coming, not coming, not sure yet: what a host can record. Nothing is chosen for no answer. */
export function ReplyChoices({
  idPrefix,
  labelledBy,
  value,
  onChange,
  describedBy,
}: ReplyChoicesProps) {
  const { t } = useTranslation('recorded-answer');
  return (
    <RadioGroup
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      value={value}
      onValueChange={(next) => {
        if (isReply(next)) onChange(next);
      }}
      className="gap-1"
    >
      {REPLIES.map((reply) => (
        <div key={reply} className="flex min-h-11 items-center gap-3">
          <RadioGroupItem value={reply} id={`${idPrefix}-${reply}`} />
          <Label htmlFor={`${idPrefix}-${reply}`} className="font-normal">
            {t(`reply.${reply}`)}
          </Label>
        </div>
      ))}
    </RadioGroup>
  );
}
