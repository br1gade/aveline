/**
 * Who receives an invitation, and who cannot.
 *
 * The unit of invitation is the **household**, not the guest. A family of
 * three shares one link and one seat allowance, so sending to each member
 * means three emails about one invitation, three people answering for the same
 * seats, and a host who looks careless. The spec's household model exists
 * precisely to avoid that (PRODUCT_SPEC §4).
 *
 * Pure, because "who gets the email" is a product rule that must be
 * inspectable and testable without a database or a mail server.
 */
export interface SendableGuest {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  isPrimary: boolean;
  locale: string | null;
  /** The capability token that personalises the link for whoever opens it. */
  token: string;
  /** Set once an erasure request has been carried out. */
  anonymizedAt: Date | null;
}

export interface SendableHousehold {
  id: string;
  name: string;
  guests: SendableGuest[];
}

export interface Recipient {
  householdId: string;
  householdName: string;
  guest: SendableGuest;
}

export interface SkippedHousehold {
  householdId: string;
  householdName: string;
  reason: string;
}

export interface SendPlan {
  recipients: Recipient[];
  skipped: SkippedHousehold[];
}

/**
 * One recipient per household.
 *
 * The primary guest holds the household's invitation, so they are preferred —
 * but an address that exists beats a role that does not. A couple where the
 * groom is primary and only the bride gave an email should still be invited,
 * and the link personalises for whoever opens it because it carries that
 * guest's own token.
 *
 * An anonymised guest is never a recipient: their erasure removed the address
 * and rotated the token, so writing to them would be both impossible and a
 * breach of the request they made.
 */
export function planInvitationSend(households: readonly SendableHousehold[]): SendPlan {
  const recipients: Recipient[] = [];
  const skipped: SkippedHousehold[] = [];

  for (const household of households) {
    const guest = chooseRecipient(household.guests);

    if (guest) {
      recipients.push({ householdId: household.id, householdName: household.name, guest });
    } else {
      skipped.push({
        householdId: household.id,
        householdName: household.name,
        reason: reasonFor(household.guests),
      });
    }
  }

  return { recipients, skipped };
}

function chooseRecipient(guests: readonly SendableGuest[]): SendableGuest | null {
  const contactable = guests.filter(isContactable);

  return contactable.find((guest) => guest.isPrimary) ?? contactable[0] ?? null;
}

function isContactable(guest: SendableGuest): boolean {
  return guest.anonymizedAt === null && isUsableEmail(guest.email);
}

/**
 * Shape only, and deliberately loose: the mail server is the authority on
 * whether an address exists, and this check exists to catch the blank and the
 * obviously-not-an-address, not to adjudicate the RFC.
 */
function isUsableEmail(email: string | null): boolean {
  if (email === null) return false;
  const trimmed = email.trim();
  return trimmed.length > 2 && trimmed.includes('@') && !trimmed.includes(' ');
}

/**
 * Reasons are written for a host reading a list of who was not invited, so
 * each one says what to do about it.
 */
function reasonFor(guests: readonly SendableGuest[]): string {
  if (guests.length === 0) return 'This household has no guests in it yet';
  if (guests.every((guest) => guest.anonymizedAt !== null)) {
    return 'This guest asked for their data to be removed';
  }

  const malformed = guests.find((guest) => guest.email !== null && !isUsableEmail(guest.email));
  if (malformed) return `"${malformed.email ?? ''}" does not look like an email address`;

  return 'No email address for anyone in this household';
}

/** The display name an invitation greets a guest by. */
export function displayName(guest: SendableGuest): string {
  return [guest.firstName, guest.lastName].filter(Boolean).join(' ');
}
