import { BadRequestException } from '@nestjs/common';

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Fills {{placeholders}} in template copy.
 *
 * Rendering happens once, at enqueue, and the result is stored on the Message.
 * That way a later template edit never rewrites what a guest already received,
 * and what was sent stays knowable.
 *
 * A missing variable throws rather than rendering an empty string, because
 * "Dear ," reaching four hundred guests is worse than a failed enqueue the
 * host can see and fix.
 *
 * Substituted values are not re-scanned, so a guest whose name contains
 * braces cannot inject a placeholder.
 */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  const missing: string[] = [];

  const rendered = template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = variables[name];
    if (value === undefined) {
      missing.push(name);
      return '';
    }
    return value;
  });

  if (missing.length > 0) {
    throw new BadRequestException(`Template is missing: ${[...new Set(missing)].join(', ')}`);
  }
  return rendered;
}
