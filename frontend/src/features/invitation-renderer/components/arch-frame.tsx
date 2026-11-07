import { cx } from '@/ui';

import type { BlockMedia } from '../types';
import { InvitationImage } from './invitation-image';

interface ArchFrameProps {
  photo: BlockMedia;
  /** The cover is on the first screen and loads at once; anything else waits until near. */
  isEager?: boolean;
  sizes: string;
  className?: string;
}

/**
 * A photograph in the arch, with a gold hairline 8 px outside it (DESIGN_SYSTEM §5). Only the
 * cover and the hosts' signature use it (PD-6). Without alt text it is decorative.
 */
export function ArchFrame({ photo, isEager = false, sizes, className }: ArchFrameProps) {
  return (
    <div className={cx('border-ornament box-border rounded-t-full border p-2', className)}>
      <InvitationImage
        photo={photo}
        sizes={sizes}
        isEager={isEager}
        className="bg-sand block aspect-[10/13] w-full rounded-t-full object-cover"
      />
    </div>
  );
}
