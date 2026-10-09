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
/** `{{#name}}…{{/name}}`: kept when `name` has a value, dropped when it is empty. */
const SECTION = /\{\{#\s*([\w.]+)\s*\}\}([\s\S]*?)\{\{\/\s*\1\s*\}\}/g;

export function renderTemplate(template: string, variables: Record<string, string>): string {
  const missing: string[] = [];

  // Sections first, so an optional line can be written in the copy — "Prefer
  // Telegram? …" only when a bot exists — instead of assembled in code.
  const withSections = template.replace(SECTION, (_match, name: string, inner: string) => {
    if (variables[name] === undefined) missing.push(name);
    return variables[name] ? inner : '';
  });

  const rendered = withSections.replace(PLACEHOLDER, (_match, name: string) => {
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
