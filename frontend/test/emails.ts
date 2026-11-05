/**
 * Addresses for the forms' tests. The first are ones the backend's `@IsEmail()` takes, checked against
 * `validator.isEmail` itself, and a browser's or Zod's rules don't. The second it refuses, and so can
 * the form, before anything is sent.
 */
export const ADDRESSES_THE_BACKEND_TAKES = [
  'ani@example.am',
  'анна@пример.рф',
  'ани@example.am',
  'ani@exämple.am',
  'a!b@example.am',
] as const;

export const ADDRESSES_NOBODY_TAKES = ['nope', 'a@b', 'a b@example.am', 'a@b@example.am'] as const;
