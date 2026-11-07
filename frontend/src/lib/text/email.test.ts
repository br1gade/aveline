// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ADDRESSES_NOBODY_TAKES, ADDRESSES_THE_BACKEND_TAKES } from '../../../test/emails';
import { isEmailShaped } from './email';

const BACKEND = join(import.meta.dirname, '../../../../backend/src');

describe('whether something is shaped like an address', () => {
  it.each(ADDRESSES_THE_BACKEND_TAKES)('takes %s', (address) => {
    expect(isEmailShaped(address)).toBe(true);
  });

  it.each(ADDRESSES_NOBODY_TAKES)('refuses %s', (address) => {
    expect(isEmailShaped(address)).toBe(false);
  });

  it.each([
    'infra/auth/dto/auth.dto.ts',
    'infra/auth/dto/account.dto.ts',
    'modules/vendors/dto/vendor.dto.ts',
    'modules/ticketing/dto/attendee.dto.ts',
    'modules/ticketing/dto/create-order.dto.ts',
    'modules/privacy/dto/privacy.dto.ts',
  ])('%s still uses the validator’s wide defaults, which this leaves the final word to', (file) => {
    const source = readFileSync(join(BACKEND, file), 'utf8');
    expect(source).toContain('@IsEmail()');
    expect(source).not.toContain('@IsEmail({');
  });
});
