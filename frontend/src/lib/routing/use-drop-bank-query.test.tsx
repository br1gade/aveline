import { act, render, screen } from '@testing-library/react';
import { createRoutesStub, useLocation, useNavigationType } from 'react-router';
import { describe, expect, it } from 'vitest';

import { plantedToken } from '../../../test/tokens';
import { useDropBankQuery } from './use-drop-bank-query';

function Page() {
  useDropBankQuery();
  const { search } = useLocation();
  return (
    <>
      <p data-testid="search">{search}</p>
      <p data-testid="navigation">{useNavigationType()}</p>
    </>
  );
}

function open(address: string) {
  const Stub = createRoutesStub([{ path: '/billing/return', Component: Page }]);
  render(<Stub initialEntries={[address]} />);
}

describe('the bank’s query in the address', () => {
  it('goes at once, and the language stays', async () => {
    const orderNumber = plantedToken();
    open(`/billing/return?orderId=${orderNumber}&lang=hy`);
    await expect.poll(() => screen.getByTestId('search').textContent).toBe('?lang=hy');
    expect(screen.getByTestId('navigation')).toHaveTextContent('REPLACE');
  });

  it('goes whole when no language was chosen', async () => {
    open('/billing/return?orderId=x&paymentID=y');
    await expect.poll(() => screen.getByTestId('search').textContent).toBe('');
  });

  it('keeps a language that spells a parameter as the language, not the parameter', async () => {
    open('/billing/return?orderId=x&lang=hy%26orderId%3Dy');
    await expect
      .poll(() => screen.getByTestId('search').textContent)
      .toBe('?lang=hy%26orderId%3Dy');
  });

  it('leaves an address holding only the language alone', async () => {
    open('/billing/return?lang=hy');
    // Long enough for a navigation the effect might start to land.
    await act(() => Promise.resolve());
    expect(screen.getByTestId('search')).toHaveTextContent('?lang=hy');
    expect(screen.getByTestId('navigation')).toHaveTextContent('POP');
  });
});
