import { MessageStatus } from '@prisma/client';
import { hasReachedGuest, isSupersededFailure } from './previous-attempts';

const at = (toAddress: string, status: MessageStatus) => ({ toAddress, status });

describe('hasReachedGuest', () => {
  it('is false for a guest who has never been sent anything', () => {
    expect(hasReachedGuest([])).toBe(false);
  });

  it.each([MessageStatus.QUEUED, MessageStatus.SENDING, MessageStatus.SENT, MessageStatus.DELIVERED])(
    'is true once an attempt is %s',
    (status) => {
      expect(hasReachedGuest([at('ani@example.am', status)])).toBe(true);
    },
  );

  it.each([MessageStatus.FAILED, MessageStatus.BOUNCED, MessageStatus.SUPPRESSED])(
    'is false when the only attempt ended %s, so the next send tries again',
    (status) => {
      expect(hasReachedGuest([at('ani@example.am', status)])).toBe(false);
    },
  );

  it('counts one success among several failures', () => {
    expect(
      hasReachedGuest([at('a@x.am', MessageStatus.BOUNCED), at('b@x.am', MessageStatus.DELIVERED)]),
    ).toBe(true);
  });
});

describe('isSupersededFailure', () => {
  it('is true for a bounce at an address the host has since corrected', () => {
    expect(isSupersededFailure(at('ani@exmaple.am', MessageStatus.BOUNCED), 'ani@example.am')).toBe(true);
  });

  it('is false for a bounce at the address still on file, ignoring case and spacing', () => {
    expect(isSupersededFailure(at(' Ani@Exmaple.am', MessageStatus.BOUNCED), 'ani@exmaple.am')).toBe(false);
  });

  // They linked Telegram from the email: the email is not history, it worked.
  it('is false for a success at a different address', () => {
    expect(isSupersededFailure(at('ani@example.am', MessageStatus.SENT), '123456789')).toBe(false);
  });

  it('is false when nothing was sent', () => {
    expect(isSupersededFailure(undefined, 'ani@example.am')).toBe(false);
  });
});
