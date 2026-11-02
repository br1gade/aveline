import { GuestAttribution } from '@prisma/client';
import { TooManyRowsError, decodeGuestCsv, parseGuestCsv } from './csv-guests';

/**
 * Hosts export from Excel, Google Sheets and phone contacts, so the input is
 * never clean. The property that matters is that a messy file still imports
 * the rows that are fine and reports the rest by row number — refusing four
 * hundred good rows over twelve bad ones sends a host back to a spreadsheet.
 */
describe('parseGuestCsv', () => {
  it('reads a minimal list of names', () => {
    const { guests, errors } = parseGuestCsv('name\nArmen\nMariam\n');

    expect(errors).toHaveLength(0);
    expect(guests.map((g) => g.firstName)).toEqual(['Armen', 'Mariam']);
  });

  it('defaults a guest with no household to their own', () => {
    const { guests } = parseGuestCsv('first name,last name\nArmen,Petrosyan\n');

    expect(guests[0].household).toBe('Armen Petrosyan');
    // Unstated, so the import sizes the household to the people it names.
    expect(guests[0].seatsAllotted).toBeUndefined();
  });

  it('groups guests who share a household name', () => {
    const { guests } = parseGuestCsv(
      'name,household,seats\nArmen,Petrosyan family,3\nLusine,Petrosyan family,3\n',
    );

    expect(new Set(guests.map((g) => g.household)).size).toBe(1);
    expect(guests.every((g) => g.seatsAllotted === 3)).toBe(true);
  });

  // The same list exported from three tools has three sets of column names.
  it.each([
    'First Name,Last Name\nArmen,Petrosyan',
    'firstname,lastname\nArmen,Petrosyan',
    'FIRST,LAST\nArmen,Petrosyan',
    'guest,surname\nArmen,Petrosyan',
  ])('accepts the header spelling %p', (csv) => {
    const { guests, errors } = parseGuestCsv(csv);

    expect(errors).toHaveLength(0);
    expect(guests[0]).toMatchObject({ firstName: 'Armen', lastName: 'Petrosyan' });
  });

  it('reads Armenian column headers', () => {
    const { guests } = parseGuestCsv('անուն,ազգանուն\nԱրմեն,Պետրոսյան\n');
    expect(guests[0].firstName).toBe('Արմեն');
  });

  it.each([
    { side: 'A', expected: GuestAttribution.SIDE_A },
    { side: 'side b', expected: GuestAttribution.SIDE_B },
    { side: 'both', expected: GuestAttribution.SHARED },
    { side: 'nonsense', expected: GuestAttribution.UNKNOWN },
    // Blank is "not said", so a re-import keeps the side already set.
    { side: '', expected: undefined },
  ])('reads a side of $side as $expected', ({ side, expected }) => {
    const { guests } = parseGuestCsv(`name,side\nArmen,${side}\n`);
    expect(guests[0].attribution).toBe(expected);
  });

  it('stops reading one row past the limit, and refuses the file', () => {
    const csv = ['name', 'A', 'B', 'C'].join('\n');

    expect(() => parseGuestCsv(csv, 2)).toThrow(TooManyRowsError);
    expect(parseGuestCsv(csv, 3).guests).toHaveLength(3);
  });

  describe('bad rows', () => {
    it('keeps the good rows and reports the bad ones by spreadsheet row number', () => {
      const { guests, errors } = parseGuestCsv('name,seats\nArmen,2\n,3\nMariam,1\n');

      expect(guests.map((g) => g.firstName)).toEqual(['Armen', 'Mariam']);
      // Header is row 1, so the empty name is row 3 — what the host sees.
      expect(errors).toEqual([{ row: 3, message: 'No name in this row' }]);
    });

    it.each(['abc', '0', '-1', '999', '2.5'])('rejects a seat count of %p', (seats) => {
      const { guests, errors } = parseGuestCsv(`name,seats\nArmen,${seats}\n`);

      expect(guests).toHaveLength(0);
      expect(errors[0]).toMatchObject({ row: 2, value: seats });
    });

    it('rejects something that is not an email, naming the value', () => {
      const { errors } = parseGuestCsv('name,email\nArmen,not-an-email\n');
      expect(errors[0]).toMatchObject({ row: 2, value: 'not-an-email' });
    });
  });

  describe('awkward files', () => {
    it('handles a quoted field containing a comma', () => {
      const { guests, errors } = parseGuestCsv('name,household\nArmen,"Petrosyan, family"\n');

      expect(errors).toHaveLength(0);
      expect(guests[0].household).toBe('Petrosyan, family');
    });

    it('strips a byte-order mark, which Excel adds', () => {
      const { guests, errors } = parseGuestCsv('﻿name\nArmen\n');

      expect(errors).toHaveLength(0);
      expect(guests[0].firstName).toBe('Armen');
    });

    it('ignores blank lines', () => {
      const { guests } = parseGuestCsv('name\nArmen\n\n\nMariam\n');
      expect(guests).toHaveLength(2);
    });

    it('trims surrounding whitespace', () => {
      const { guests } = parseGuestCsv('name , household \n  Armen , Petrosyan \n');
      expect(guests[0]).toMatchObject({ firstName: 'Armen', household: 'Petrosyan' });
    });

    it('reports a header with no rows rather than importing nothing silently', () => {
      const { guests, errors } = parseGuestCsv('name,email\n');

      expect(guests).toHaveLength(0);
      expect(errors[0].message).toMatch(/no rows/i);
    });

    it('reports an empty file', () => {
      expect(parseGuestCsv('').errors).toHaveLength(1);
    });

    // Excel set to Russian or Armenian writes ";" between columns, because
    // "," is the decimal separator there; Google Sheets can write tabs.
    it.each([
      ['semicolons', 'name;email;seats\nArmen;armen@test.local;2\n'],
      ['tabs', 'name\temail\tseats\nArmen\tarmen@test.local\t2\n'],
    ])('reads columns separated by %s', (_, content) => {
      const { guests, errors } = parseGuestCsv(content);

      expect(errors).toHaveLength(0);
      expect(guests[0]).toMatchObject({
        firstName: 'Armen',
        email: 'armen@test.local',
        seatsAllotted: 2,
      });
    });

    it('keeps a semicolon inside a name in a comma-separated file', () => {
      const { guests } = parseGuestCsv('name,household\nArmen,"Petrosyan; Avagyan"\n');

      expect(guests[0].household).toBe('Petrosyan; Avagyan');
    });

    it('reads Russian column headers', () => {
      const { guests } = parseGuestCsv('Имя;Фамилия;Телефон\nАрмен;Петросян;+37491000000\n');

      expect(guests[0]).toMatchObject({
        firstName: 'Армен',
        lastName: 'Петросян',
        phone: '+37491000000',
      });
    });

    it('reports a file with no name column once, listing the headings it found', () => {
      const { guests, errors } = parseGuestCsv('Guest name|Seats\nArmen|2\nMariam|1\n');

      expect(guests).toHaveLength(0);
      expect(errors).toEqual([
        { row: 0, message: 'No first-name column found. Headings read: guest name|seats' },
      ]);
    });
  });

  /**
   * SMTP ends a command with CRLF, so an address carrying one is two
   * commands: mail sent as us, from an address we never approved. This exact
   * value was imported successfully and would have been handed to the mail
   * transport before the address validator existed.
   *
   * A lone trailing CR is deliberately not tested here: the CSV parser's own
   * `trim` removes it, so what reaches the validator is already a safe
   * address. It is rejected at the validator itself — see
   * `common/address.spec.ts` — which is where the rule belongs, since not
   * every address arrives through a CSV.
   */
  it.each([
    'armen@test.local\r\nMAIL FROM:<attacker@evil.test>',
    'armen@test.local\nRCPT TO:<attacker@evil.test>',
  ])('rejects an address carrying a protocol command', (email) => {
    const { guests, errors } = parseGuestCsv(`name,email\nArmen,"${email}"\n`);

    expect(guests).toHaveLength(0);
    expect(errors[0].message).toContain('does not look like an email address');
  });
});

describe('decodeGuestCsv', () => {
  it('reads UTF-8, with or without a byte-order mark', () => {
    expect(decodeGuestCsv(Buffer.from('\uFEFFname\nԱրմեն\n', 'utf8'))).toEqual({
      text: '\uFEFFname\nԱրմեն\n',
    });
  });

  // "Армен" in Windows-1251, which Russian Excel writes unless "CSV UTF-8"
  // is chosen. Decoded as UTF-8 it would import as replacement characters.
  it('refuses a file in a Windows code page instead of importing garbled names', () => {
    const windows1251 = Buffer.from([0xc8, 0xec, 0xff, 0x0a, 0xc0, 0xf0, 0xec, 0xe5, 0xed]);

    expect(decodeGuestCsv(windows1251)).toEqual({
      error:
        'The file is not UTF-8 text. In Excel, save it as "CSV UTF-8 (comma delimited)" and import again',
    });
  });
});
