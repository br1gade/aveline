import { useState } from 'react';

import { refusalOf, type SeatingAction } from '../refusals';
import type { SeatingHost } from './use-seating-host';

/**
 * An action taken in place, without a dialog: unseating, dismissing a freed seat, seating again.
 * One runs at a time; its button says so. A refusal shows at the top of the page, and the page
 * reloads behind it when it is out of date.
 */
export function useInPlace(host: SeatingHost) {
  const [running, setRunning] = useState<string | null>(null);
  const run = async (id: string, action: SeatingAction, write: () => Promise<string>) => {
    host.refuse(null);
    setRunning(id);
    try {
      await host.announce(await write());
    } catch (error) {
      const refusal = refusalOf(error, action);
      host.refuse(refusal);
      if (refusal.isStale) host.reload();
    } finally {
      setRunning(null);
    }
  };
  return { running, run };
}
