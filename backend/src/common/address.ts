/**
 * What a recipient address may contain.
 *
 * This is a security boundary, not a convenience check. Every mail and chat
 * protocol in use here is line-oriented: SMTP ends a command with CRLF, so an
 * address carrying one is two commands. An address of
 *
 *     armen@example.am\r\nMAIL FROM:<attacker@evil.test>
 *
 * handed to an SMTP client is an injected envelope — mail sent as us, from an
 * address we never approved, counted against our sending reputation.
 *
 * That exact value reached the transport through CSV import until this
 * existed: the import's own check required an `@` and no spaces, and a
 * carriage return is neither. One validator rather than three, because the
 * version of this that gets forgotten is the fourth copy.
 */

/**
 * Control characters, including CR and LF.
 *
 * A range rather than a list of the two that matter: a bare CR, a vertical
 * tab and a NUL are all equally unwelcome in a protocol header, and naming
 * only `\r\n` invites the next one through.
 */
// eslint-disable-next-line no-control-regex -- the control characters are the point: this rule exists to catch them appearing by accident, and here they are what we are deliberately looking for
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Long enough for any real address, short enough not to be a payload. */
const MAX_ADDRESS_LENGTH = 320;

/**
 * Whether this can be handed to a transport.
 *
 * Shape only, and deliberately loose about what makes an address *valid* —
 * the mail server is the authority on whether a mailbox exists, and a
 * stricter pattern here would reject real addresses. What it is strict about
 * is what makes an address *dangerous*.
 */
export function isSafeAddress(address: string | null | undefined): boolean {
  if (!address) return false;

  // Tested against the raw value, not the trimmed one. `trim()` strips a
  // trailing CR, so validating the trimmed form would accept
  // `a@b.c\r\nRCPT TO:<x>` whenever the untrimmed value is what gets sent —
  // a bypass that depends on two call sites agreeing, which is exactly the
  // kind of agreement that stops holding.
  if (CONTROL_CHARACTERS.test(address)) return false;

  const trimmed = address.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_ADDRESS_LENGTH;
}

/**
 * Whether this is usable as an email address.
 *
 * Safety first, then the minimum shape that distinguishes an address from a
 * name a host typed into the wrong column.
 */
export function isUsableEmailAddress(email: string | null | undefined): boolean {
  if (!isSafeAddress(email)) return false;

  const trimmed = (email ?? '').trim();
  return trimmed.length > 2 && trimmed.includes('@') && !/\s/.test(trimmed);
}

/**
 * The address as it should be stored and sent.
 *
 * Email is lower-cased because it is case-insensitive in practice, and a
 * suppression recorded for `ani@x.am` must match `Ani@X.am`. Phone numbers
 * and chat ids are only trimmed: normalising them correctly needs a region,
 * and guessing wrong would address the wrong person.
 */
export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}
