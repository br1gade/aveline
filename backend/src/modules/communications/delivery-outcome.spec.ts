import {
  MAX_DELIVERY_ATTEMPTS,
  classifyDeliveryFailure,
  isWorthRetrying,
  nextAttemptAt,
  shouldSuppressAddress,
} from './delivery-outcome';

/** An SMTP rejection as nodemailer surfaces it. */
const smtpError = (responseCode: number, response: string) =>
  Object.assign(new Error(response), { responseCode, response, code: 'EENVELOPE' });

const socketError = (code: string) => Object.assign(new Error(code), { code });

describe('classifyDeliveryFailure', () => {
  describe('what the recipient refused', () => {
    // 5xx is permanent by the RFC: retrying changes nothing and hammering a
    // dead mailbox damages the sending domain's reputation.
    it.each([
      { code: 550, label: 'no such mailbox' },
      { code: 551, label: 'user not local' },
      { code: 553, label: 'mailbox name not allowed' },
    ])('treats $code ($label) as undeliverable', ({ code }) => {
      expect(classifyDeliveryFailure(smtpError(code, `${code} rejected`)).kind).toBe(
        'UNDELIVERABLE',
      );
    });

    it.each([
      '550 5.1.1 The email account that you tried to reach does not exist',
      '550 5.1.10 Recipient not found',
      '550 5.2.1 The email account that you tried to reach is disabled',
    ])('treats "%s" as the recipient refusing', (response) => {
      expect(classifyDeliveryFailure(smtpError(550, response)).kind).toBe('UNDELIVERABLE');
    });
  });

  // B71: every 5xx counted as the guest's hard bounce, including our own
  // quota, size and policy rejections — and a hard bounce suppresses the
  // address platform-wide for good.
  describe('what was refused because of us', () => {
    it.each([
      '550 5.4.5 Daily user sending quota exceeded',
      '552 5.3.4 Your message exceeded Google\'s message size limits',
      '550 5.7.1 Our system has detected that this message is likely unsolicited mail',
      '554 5.7.0 Too many invalid recipients',
      '535 5.7.8 Username and Password not accepted',
    ])('never holds "%s" against the recipient', (response) => {
      const failure = classifyDeliveryFailure(smtpError(Number(response.slice(0, 3)), response));

      expect(failure.kind).toBe('MISCONFIGURED');
      expect(shouldSuppressAddress(failure.kind)).toBe(false);
    });

    it.each([554, 599])('treats a bare %s, which names no recipient fault, as ours', (code) => {
      expect(classifyDeliveryFailure(smtpError(code, `${code} rejected`)).kind).toBe('MISCONFIGURED');
    });

    it('carries the server’s own words as the reason', () => {
      const failure = classifyDeliveryFailure(smtpError(550, '550 5.1.1 No such user here'));

      expect(failure.reason).toBe('550 5.1.1 No such user here');
    });
  });

  describe('what the provider could not take now', () => {
    /**
     * The replies that look permanent and are not. 421 is service-unavailable,
     * 450/451 are greylisting, 452 is over-quota — all of which succeed on a
     * later attempt, and all of which would lose an invitation if treated as
     * final.
     */
    it.each([421, 450, 451, 452])('treats %s as temporary', (code) => {
      expect(classifyDeliveryFailure(smtpError(code, `${code} try again`)).kind).toBe('TEMPORARY');
    });

    it.each(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKET', 'EAI_AGAIN', 'EDNS'])(
      'treats a %s socket failure as temporary',
      (code) => {
        expect(classifyDeliveryFailure(socketError(code)).kind).toBe('TEMPORARY');
      },
    );

    /**
     * An unrecognised error is temporary on purpose. Being wrong this way
     * costs a few retries; being wrong the other way suppresses an address
     * that was never at fault, which is much harder to notice and to undo.
     */
    it.each([
      { label: 'a bare Error', error: new Error('something odd') },
      { label: 'a string', error: 'something odd' },
      { label: 'null', error: null },
      { label: 'an empty object', error: {} },
    ])('treats $label as temporary rather than guessing', ({ error }) => {
      expect(classifyDeliveryFailure(error).kind).toBe('TEMPORARY');
    });
  });

  describe('what is our fault', () => {
    // Our bad password must never suppress a guest's address.
    it.each(['EAUTH', 'ESECURITY', 'ETLS', 'ECONFIG'])('treats %s as misconfiguration', (code) => {
      expect(classifyDeliveryFailure(socketError(code)).kind).toBe('MISCONFIGURED');
    });

    it('prefers the configuration reading over the response code', () => {
      const error = Object.assign(new Error('535 auth failed'), {
        code: 'EAUTH',
        responseCode: 535,
      });

      expect(classifyDeliveryFailure(error).kind).toBe('MISCONFIGURED');
    });
  });
});

describe('isWorthRetrying', () => {
  it('never retries an undeliverable address', () => {
    expect(isWorthRetrying('UNDELIVERABLE', 1)).toBe(false);
  });

  it.each([
    { attempts: 1, isWorth: true },
    { attempts: MAX_DELIVERY_ATTEMPTS - 1, isWorth: true },
    { attempts: MAX_DELIVERY_ATTEMPTS, isWorth: false },
    { attempts: MAX_DELIVERY_ATTEMPTS + 1, isWorth: false },
  ])('after $attempts attempt(s) on a temporary failure', ({ attempts, isWorth }) => {
    expect(isWorthRetrying('TEMPORARY', attempts)).toBe(isWorth);
  });

  // A misconfiguration is fixed by us, so the message should still be waiting
  // when it is — but not forever.
  it('retries a misconfiguration within the same budget', () => {
    expect(isWorthRetrying('MISCONFIGURED', 1)).toBe(true);
    expect(isWorthRetrying('MISCONFIGURED', MAX_DELIVERY_ATTEMPTS)).toBe(false);
  });
});

describe('nextAttemptAt', () => {
  const NOW = new Date('2026-10-05T12:00:00.000Z');

  it('waits longer after each attempt', () => {
    const delays = [1, 2, 3, 4, 5].map(
      (attempts) => nextAttemptAt(attempts, NOW).getTime() - NOW.getTime(),
    );

    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(new Set(delays).size).toBe(delays.length);
  });

  it('starts a minute out, so a blip clears quickly', () => {
    expect(nextAttemptAt(1, NOW)).toEqual(new Date('2026-10-05T12:01:00.000Z'));
  });

  it('caps the wait rather than growing without bound', () => {
    expect(nextAttemptAt(99, NOW)).toEqual(nextAttemptAt(MAX_DELIVERY_ATTEMPTS, NOW));
  });

  // Defensive: a zero or negative attempt count must still schedule forwards.
  it.each([0, -1])('schedules forwards even from %s attempts', (attempts) => {
    expect(nextAttemptAt(attempts, NOW).getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe('shouldSuppressAddress', () => {
  // The asymmetry is the point: only the recipient's own refusal suppresses.
  it.each([
    { kind: 'UNDELIVERABLE' as const, should: true },
    { kind: 'TEMPORARY' as const, should: false },
    { kind: 'MISCONFIGURED' as const, should: false },
  ])('$kind → $should', ({ kind, should }) => {
    expect(shouldSuppressAddress(kind)).toBe(should);
  });
});
