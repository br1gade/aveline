import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { createI18n } from '@/lib/i18n';
import { guardedRoutes, isLeavingAsked } from '@/ui/app-form/guarded-routes';

import type { HouseholdToSeat } from './candidates';
import { SeatDialog } from './components/seat-dialog';
import type { SeatingHost } from './components/use-seating-host';
import { readTables } from './read';
import { TABLES } from './test-data';

const host = {
  eventId: 'e1',
  open: vi.fn(),
  saved: vi.fn(),
  announce: vi.fn(),
  reload: vi.fn(),
  close: vi.fn(),
  restoreFocus: vi.fn(),
} as unknown as SeatingHost;
const tables = readTables(TABLES);
const household = (homeTableIds: string[]): HouseholdToSeat => ({
  id: 'h1',
  name: 'Sargsyan family',
  guests: [{ id: 'g4', name: 'Ani Sargsyan' }],
  homeTableIds,
});

describe('the seat dialog’s unsaved changes (PD-146)', () => {
  it('asks nothing when a reload behind it puts another table first, as the host picked nothing', async () => {
    let reloadWith: (homeTableIds: string[]) => void = () => undefined;
    function Dialog() {
      const [homes, setHomes] = useState(['t1']);
      reloadWith = setHomes;
      const seated = household(homes);
      return (
        <SeatDialog
          host={host}
          household={seated}
          guests={seated.guests}
          tables={tables}
          venueRoom={null}
        />
      );
    }
    const Stub = createRoutesStub(guardedRoutes([{ path: '/', Component: Dialog }]));
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <Stub />
      </I18nextProvider>,
    );
    await screen.findByRole('dialog');
    expect(isLeavingAsked()).toBe(false);
    act(() => reloadWith(['t2']));
    expect(screen.getByLabelText('Table')).toHaveDisplayValue(/^Table 1/);
    expect(isLeavingAsked()).toBe(false);
  });
});
