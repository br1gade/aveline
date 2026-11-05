// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { openSchema } from './schemas';

const DTO = readFileSync(
  join(import.meta.dirname, '../../../../backend/src/modules/organizations/dto/concierge.dto.ts'),
  'utf8',
);
const valid = { name: 'Petrosyan', kind: 'HOST', ownerEmail: 'anna@example.am' };
const isTaken = (over: Record<string, unknown>) =>
  openSchema.safeParse({ ...valid, ...over }).success;

describe('opening an account keeps the backend’s limits', () => {
  it.each([
    [1, false],
    [2, true],
    [160, true],
    [161, false],
  ])('a name of %i characters: %s', (length, taken) => {
    expect(isTaken({ name: 'n'.repeat(length) })).toBe(taken);
  });

  it.each([
    [200, true],
    [201, false],
  ])('an address of %i characters: %s', (length, taken) => {
    const ownerEmail = `${'a'.repeat(length - '@example.am'.length)}@example.am`;
    expect(isTaken({ ownerEmail })).toBe(taken);
  });

  it('counts neither without the spaces around it', () => {
    expect(openSchema.parse({ ...valid, name: '  ab  ', ownerEmail: ' a@x.am ' })).toEqual({
      ...valid,
      name: 'ab',
      ownerEmail: 'a@x.am',
    });
  });

  it('is pinned to the DTO', () => {
    expect(DTO).toMatch(/@MaxLength\(200\)\s+ownerEmail/);
  });
});
