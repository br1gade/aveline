import type { ReactNode } from 'react';

import type { InvitationBlock } from '../types';

export interface BlockProps {
  block: InvitationBlock;
  /** Its position in `blocks`, which is display order (never sorted). */
  index: number;
}

export type BlockComponent = (props: BlockProps) => ReactNode;
