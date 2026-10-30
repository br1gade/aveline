import { describe, expect, it } from 'vitest';

import { bulkTablesSchema, tableFormSchema } from './schemas';

const issue = (result: {
  success: boolean;
  error?: { issues: Array<{ path: PropertyKey[]; message: string }> };
}) => result.error?.issues.map(({ path, message }) => [String(path[0]), message]) ?? [];

describe('one table’s form, with the backend’s limits (CreateTableDto, UpdateTableDto)', () => {
  const schema = tableFormSchema(0);
  const valid = { name: ' Table 1 ', capacity: '10', zone: ' Terrace ' };

  it('trims and gives the seats as a number', () => {
    expect(schema.parse(valid)).toEqual({ name: 'Table 1', capacity: 10, zone: 'Terrace' });
    expect(schema.parse({ ...valid, zone: '  ' })).toEqual({
      name: 'Table 1',
      capacity: 10,
      zone: '',
    });
  });

  it.each([
    [{ name: '' }, [['name', 'required']]],
    [{ name: 'x'.repeat(61) }, [['name', 'tooLong']]],
    [{ name: 'x'.repeat(60) }, []],
    [{ capacity: '0' }, [['capacity', 'seats']]],
    [{ capacity: '1' }, []],
    [{ capacity: '100' }, []],
    [{ capacity: '101' }, [['capacity', 'seats']]],
    [{ capacity: '2.5' }, [['capacity', 'seats']]],
    [{ capacity: '' }, [['capacity', 'seats']]],
    [{ zone: 'x'.repeat(61) }, [['zone', 'tooLong']]],
    [{ zone: 'x'.repeat(60) }, []],
  ])('%o', (change, issues) => {
    expect(issue(schema.safeParse({ ...valid, ...change }))).toEqual(issues);
  });

  it('never goes below the guests already seated', () => {
    const seated = tableFormSchema(7);
    expect(issue(seated.safeParse({ ...valid, capacity: '6' }))).toEqual([
      ['capacity', 'belowSeated'],
    ]);
    expect(seated.safeParse({ ...valid, capacity: '7' }).success).toBe(true);
  });
});

describe('several tables at once (CreateTablesDto)', () => {
  const valid = { namePrefix: 'Table', count: '20', capacity: '10', zone: '' };

  it('gives numbers, trimmed', () => {
    expect(bulkTablesSchema.parse({ ...valid, namePrefix: ' Table ' })).toEqual({
      namePrefix: 'Table',
      count: 20,
      capacity: 10,
      zone: '',
    });
  });

  it.each([
    [{ namePrefix: '' }, [['namePrefix', 'required']]],
    [{ namePrefix: 'x'.repeat(41) }, [['namePrefix', 'tooLong']]],
    [{ namePrefix: 'x'.repeat(40) }, []],
    [{ count: '0' }, [['count', 'count']]],
    [{ count: '1' }, []],
    [{ count: '200' }, []],
    [{ count: '201' }, [['count', 'count']]],
    [{ capacity: '0' }, [['capacity', 'seats']]],
    [{ capacity: '101' }, [['capacity', 'seats']]],
    [{ zone: 'x'.repeat(61) }, [['zone', 'tooLong']]],
  ])('%o', (change, issues) => {
    expect(issue(bulkTablesSchema.safeParse({ ...valid, ...change }))).toEqual(issues);
  });
});
