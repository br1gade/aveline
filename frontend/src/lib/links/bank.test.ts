import { describe, expect, it } from 'vitest';

import { bankAddress } from './bank';

const ORIGIN = 'https://aveline.test';

describe("the bank's payment page", () => {
  it.each([
    ['https://servicestest.ameriabank.am/VPOS/Payments/Pay?id=1', true],
    ['https://aveline.test/tickets/return?fakePayment=abc', true],
    ['http://aveline.test/tickets/return', false],
    ['http://bank.example/pay', false],
    ['javascript:alert(1)', false],
    ['/tickets/return?fakePayment=abc', true],
    ['', false],
    [null, false],
  ])('%j is followed: %s', (address, isFollowed) => {
    expect(bankAddress(address, ORIGIN) !== null).toBe(isFollowed);
  });

  it('follows a page of this client over http in development', () => {
    expect(bankAddress('http://localhost:5173/tickets/return?x=1', 'http://localhost:5173')).toBe(
      'http://localhost:5173/tickets/return?x=1',
    );
  });
});
