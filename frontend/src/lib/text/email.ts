const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Whether a value could be an address: one `@`, no spaces, a dot after it. Deliberately no more: the
 * backend's `@IsEmail()` has the final word, and it takes addresses a browser's rules don't, such as
 * `анна@пример.рф`. This stops the plain mistakes before anything is sent, and never one it would take.
 */
export function isEmailShaped(value: string): boolean {
  return SHAPE.test(value);
}
