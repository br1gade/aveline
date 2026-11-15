import { Children, type ReactNode } from 'react';

import { capsSafe } from '@/lib/text';

/** The words of what is shown in capitals made ready for them (`capsSafe`); icons pass through. */
export function inCapitals(children: ReactNode): ReactNode {
  return Children.map(children, (child) => (typeof child === 'string' ? capsSafe(child) : child));
}
