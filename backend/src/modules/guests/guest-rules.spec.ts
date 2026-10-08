import { capacityProblem, readEmail, readPhone, removalProblem, toColumn } from './guest-rules';

describe('removalProblem', () => {
  // Decided: answers and seats go with the guest; arrival does not.
  it('allows removing a guest who has not arrived', () => {
    expect(removalProblem({ checkedIn: false, anonymized: false })).toBeNull();
  });

  it('refuses a guest who was checked in, saying why', () => {
    expect(removalProblem({ checkedIn: true, anonymized: false })).toContain('checked in');
  });
});

describe('capacityProblem', () => {
  it.each([
    { seats: 3, guests: 2, ok: true },
    { seats: 3, guests: 3, ok: true },
    { seats: 3, guests: 4, ok: false },
  ])('$guests guests in $seats seats → ok: $ok', ({ seats, guests, ok }) => {
    expect(capacityProblem(seats, guests) === null).toBe(ok);
  });
});

describe('readEmail', () => {
  it('leaves an omitted email alone', () => {
    expect(readEmail(undefined)).toEqual({ kind: 'unchanged' });
  });

  it.each(['', '   '])('treats %j as clearing it', (raw) => {
    expect(readEmail(raw)).toEqual({ kind: 'clear' });
  });

  it('normalises a valid address', () => {
    expect(readEmail('  Ani@Example.AM ')).toEqual({ kind: 'set', value: 'ani@example.am' });
  });

  /**
   * A host-typed address reaches the same SMTP transport as an imported one,
   * so it must refuse the same injection the CSV path refuses.
   */
  it('refuses an address carrying an SMTP command', () => {
    expect(readEmail('ani@example.am\r\nRCPT TO:<x@evil.test>').kind).toBe('invalid');
  });

  it.each(['not-an-address', 'two words@example.am'])('refuses %s', (raw) => {
    expect(readEmail(raw).kind).toBe('invalid');
  });
});

describe('readPhone', () => {
  it.each(['+374 10 000000', '+37410000000', '(010) 00-00-00'])('accepts %s', (raw) => {
    expect(readPhone(raw).kind).toBe('set');
  });

  it.each(['call me', '123', '+374\r\n10000000'])('refuses %j', (raw) => {
    expect(readPhone(raw).kind).toBe('invalid');
  });
});

describe('toColumn', () => {
  it('maps each input to what is written', () => {
    expect(toColumn({ kind: 'set', value: 'a@b.c' })).toBe('a@b.c');
    expect(toColumn({ kind: 'clear' })).toBeNull();
    expect(toColumn({ kind: 'unchanged' })).toBeUndefined();
  });
});
