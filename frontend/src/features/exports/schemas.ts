import { z } from 'zod';

import { LANGUAGES } from '@/lib/i18n';

import { EXPORT_FORMATS, EXPORT_KINDS } from './types';

/**
 * The export form (design PD-74). Every field is a choice among the API's own values, so nothing
 * here can be refused for its shape; `withContacts` is read only where the kind offers it.
 */
export const exportSchema = z.object({
  kind: z.enum(EXPORT_KINDS),
  format: z.enum(EXPORT_FORMATS),
  locale: z.enum(LANGUAGES),
  withContacts: z.boolean(),
});

export type ExportValues = z.infer<typeof exportSchema>;
