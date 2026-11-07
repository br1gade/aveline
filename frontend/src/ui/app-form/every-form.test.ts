// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../..');

/** Forms that don't join the guard, each for a reason; a new one has to give its own (PD-146). */
const NOT_ASKED: Readonly<Record<string, string>> = {
  'features/account/components/sign-in.tsx': 'an address and a password, typed again in seconds',
  'features/account/components/register.tsx': 'the same, and outside the app’s frame',
  'features/account/components/reset-password.tsx': 'the same',
  'features/account/components/accept-invite.tsx': 'the same',
  'features/exports/components/exports-page.tsx': 'made here, joined in its child, export-form.tsx',
};

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
  });
}

/** A line commented out doesn't guard anything. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const forms = sourceFiles(join(SRC, 'features'))
  .filter((path) => /\buseForm[<(]/.test(readFileSync(path, 'utf8')))
  .map((path) => relative(SRC, path));

describe('a form holding someone’s work', () => {
  it('finds the forms', () => {
    expect(forms).toContain('features/seating/components/table-dialog.tsx');
    expect(forms.length).toBeGreaterThan(30);
  });

  it.each(forms.filter((path) => !(path in NOT_ASKED)))('%s asks before it is left', (path) => {
    expect(withoutComments(readFileSync(join(SRC, path), 'utf8'))).toMatch(
      /useLeaveGuard(?:When)?\(/,
    );
  });

  it.each(Object.keys(NOT_ASKED))('%s is still a form, or leaves the list', (path) => {
    expect(forms).toContain(path);
  });

  it.each([
    'routes/app/layout.tsx',
    'routes/public/checkout.tsx',
    'routes/public/guest-invitation.tsx',
    'routes/public/privacy-request.tsx',
  ])('%s holds the guard its forms tell, which otherwise do nothing', (path) => {
    expect(readFileSync(join(SRC, path), 'utf8')).toContain('<LeaveGuard>');
  });
});
