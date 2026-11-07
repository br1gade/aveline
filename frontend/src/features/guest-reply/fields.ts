import type { FieldErrors } from 'react-hook-form';

import type { ReplyFormValues } from './form-model';

/** The element id for a form path: `party.0.firstName` is `reply-party-0-firstName`. */
export function fieldId(path: string): string {
  return `reply-${path.replaceAll('.', '-')}`;
}

export interface PathMessage {
  path: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Every message in React Hook Form's nested errors, in the form's order, with its path. */
export function flattenErrors(errors: FieldErrors<ReplyFormValues>): PathMessage[] {
  const found: PathMessage[] = [];
  function walk(node: unknown, path: string) {
    if (!isRecord(node)) return;
    if (typeof node.message === 'string' && node.message) {
      found.push({ path, message: node.message });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== 'ref' && key !== 'root') walk(child, path ? `${path}.${key}` : key);
    }
  }
  walk(errors, '');
  return found;
}
