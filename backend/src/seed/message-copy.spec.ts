import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MESSAGE_COPY } from './message-copy';

/**
 * Every message the code sends has copy to send it with.
 *
 * This failure has happened twice. `ticket.issued` was seeded with nothing
 * sending it, so buyers paid and received nothing; and the cancellation notice
 * was written to send `ticket.cancelled` before any copy for it existed, which
 * would have failed quietly on every cancellation. Both were found by audit.
 * This makes the next one a red build instead.
 *
 * It reads the source rather than a registry because the keys are string
 * literals at the call sites, and a registry would be a second list to keep
 * in step — the exact problem being guarded against.
 */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

/** Template keys written as literals where the code sends a message. */
function keysTheCodeSends(): string[] {
  const keys = new Set<string>();
  const patterns = [
    /templateKey:\s*'([a-z]+(?:[.-][a-z]+)+)'/g,
    /const [A-Z_]*TEMPLATE_KEY = '([a-z]+(?:[.-][a-z]+)+)'/g,
    /\]:\s*'(rsvp\.confirmation\.[a-z]+)'/g,
  ];

  for (const file of sourceFiles(join(__dirname, '..'))) {
    if (file.includes(`${join('seed', '')}`) || file.endsWith('seed-production.ts')) continue;
    const source = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) keys.add(match[1]);
    }
  }
  return [...keys].sort();
}

describe('message copy', () => {
  const seeded = new Set(MESSAGE_COPY.map((template) => template.key));

  it('finds the keys it is meant to check', () => {
    // A guard on the guard: if the patterns stop matching, this test would
    // pass by checking nothing.
    expect(keysTheCodeSends()).toEqual(
      expect.arrayContaining(['invitation.send', 'ticket.issued', 'ticket.cancelled']),
    );
  });

  it.each(keysTheCodeSends())('has copy for %s', (key) => {
    expect(seeded.has(key)).toBe(true);
  });

  // Copy nobody sends is how `ticket.issued` sat unsent for weeks.
  it.each([...seeded].sort())('sends %s from somewhere', (key) => {
    expect(keysTheCodeSends()).toContain(key);
  });

  it('gives venue-response confirmations all four pilot languages on every supported channel', () => {
    const confirmations = MESSAGE_COPY.filter((template) => template.key === 'rsvp.confirmation.venues');
    expect(confirmations.map((template) => template.channel).sort()).toEqual(['EMAIL', 'TELEGRAM', 'WHATSAPP']);
    for (const template of confirmations) expect(Object.keys(template.body).sort()).toEqual(['en', 'fr', 'hy', 'ru']);
  });

  // The pilot's languages: French was dropped for the pilot on 14 November 2026
  // and falls back to the event's language, then English (audit F-02).
  const PILOT_LANGUAGES = ['en', 'hy', 'ru'];
  const named = (template: (typeof MESSAGE_COPY)[number]) => [`${template.key} by ${template.channel}`, template] as const;

  it.each(MESSAGE_COPY.map(named))('writes the body of %s in Armenian, English and Russian', (_name, template) => {
    expect(Object.keys(template.body)).toEqual(expect.arrayContaining(PILOT_LANGUAGES));
  });

  it.each(MESSAGE_COPY.filter((template) => 'subject' in template && template.subject).map(named))(
    'writes the subject of %s in Armenian, English and Russian', (_name, template) => {
      expect(Object.keys((template as { subject: object }).subject)).toEqual(expect.arrayContaining(PILOT_LANGUAGES));
    },
  );
});
