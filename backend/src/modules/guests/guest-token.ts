import { customAlphabet } from 'nanoid';

/**
 * A guest's capability token — the segment of their personal invitation link.
 *
 * Holding the link is the authorization, so this is a credential: twelve
 * characters from an alphabet without the look-alikes (no 0/O, 1/l/i), which
 * matters because guests read these aloud and type them from a printed card.
 *
 * Extracted on the third caller. RSVP party members and CSV import each built
 * their own generator, and host-added guests needed one too; three copies of a
 * credential's shape is how one of them ends up shorter than the others.
 */
export const newGuestToken = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 12);
