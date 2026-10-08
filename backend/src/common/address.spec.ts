import { isSafeAddress, isUsableEmailAddress, normalizeEmailAddress } from './address';

describe('isSafeAddress', () => {
  it.each(['armen@example.am', '+37410000000', '123456789', 'Ani.Grigoryan+tag@example.co.uk'])(
    'accepts %s',
    (address) => {
      expect(isSafeAddress(address)).toBe(true);
    },
  );

  /**
   * The injection this exists to stop. SMTP ends a command with CRLF, so an
   * address carrying one is two commands — mail sent as us, from an address
   * we never approved. This exact value reached the transport through CSV
   * import before this validator existed.
   */
  it('rejects the SMTP envelope injection', () => {
    expect(isSafeAddress('armen@example.am\r\nMAIL FROM:<attacker@evil.test>')).toBe(false);
  });

  // A list of just CR and LF invites the next control character through.
  it.each([
    { label: 'a carriage return', address: 'a@b.c\r' },
    { label: 'a line feed', address: 'a@b.c\n' },
    { label: 'a bare CR mid-string', address: 'a\rb@c.d' },
    { label: 'a NUL', address: 'a@b.c\u0000' },
    { label: 'a vertical tab', address: 'a@b.c\u000b' },
    { label: 'a tab', address: 'a@b.c\t' },
    { label: 'a delete character', address: 'a@b.c\u007f' },
  ])('rejects $label', ({ address }) => {
    expect(isSafeAddress(address)).toBe(false);
  });

  it.each([
    { label: 'null', address: null },
    { label: 'undefined', address: undefined },
    { label: 'empty', address: '' },
    { label: 'only spaces', address: '   ' },
  ])('rejects $label', ({ address }) => {
    expect(isSafeAddress(address)).toBe(false);
  });

  it('rejects something long enough to be a payload', () => {
    expect(isSafeAddress(`${'a'.repeat(320)}@example.am`)).toBe(false);
  });

  it('accepts a long but plausible address', () => {
    expect(isSafeAddress(`${'a'.repeat(60)}@example.am`)).toBe(true);
  });
});

describe('isUsableEmailAddress', () => {
  it.each(['armen@example.am', '  armen@example.am  ', 'Ani@Example.AM'])(
    'accepts %s',
    (email) => {
      expect(isUsableEmailAddress(email)).toBe(true);
    },
  );

  it.each([
    { label: 'no at sign', email: 'armen.example.am' },
    { label: 'a name in the wrong column', email: 'Armen Petrosyan' },
    { label: 'too short', email: 'a@' },
    { label: 'an internal space', email: 'two words@example.am' },
  ])('rejects $label', ({ email }) => {
    expect(isUsableEmailAddress(email)).toBe(false);
  });

  // Safety is checked first, so an injection is rejected even though it
  // otherwise looks like an address.
  it('rejects an injection that would pass the shape check', () => {
    expect(isUsableEmailAddress('a@b.c\r\nRCPT TO:<x@y.z>')).toBe(false);
  });
});

describe('normalizeEmailAddress', () => {
  // A suppression recorded for ani@x.am must match Ani@X.am.
  it.each([
    { raw: 'Ani@Example.AM', expected: 'ani@example.am' },
    { raw: '  armen@example.am  ', expected: 'armen@example.am' },
  ])('$raw → $expected', ({ raw, expected }) => {
    expect(normalizeEmailAddress(raw)).toBe(expected);
  });
});
