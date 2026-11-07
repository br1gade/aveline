import { isApiError } from '@/api/errors';

/** The backend has the last word on an address (`isEmailShaped`), and its refusal goes on the field. */
export function isAddressRefused(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.status === 400 &&
    error.messages.some((said) => /^email\b/.test(said))
  );
}
