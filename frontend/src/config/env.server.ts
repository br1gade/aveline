import { z } from 'zod';

/**
 * Configuration for the rendering server only. The `.server` suffix keeps it out of the browser
 * bundle.
 */
const serverSchema = z.object({
  /** Where server loaders reach the API: the internal network, not the public origin. */
  API_INTERNAL_URL: z.url().default('http://localhost:3000'),
  /**
   * The bank a paid ticket order is sent to (design PD-82), until the API says which are set up
   * (FR-64). The backend's in-process `FAKE` gateway exists only in development, and the
   * production backend refuses it.
   */
  TICKET_PAYMENT_PROVIDER: z.enum(['AMERIABANK', 'INECOBANK', 'IDBANK', 'FAKE']).optional(),
});

type ParsedEnv = z.infer<typeof serverSchema>;

export type ServerEnv = ParsedEnv & {
  TICKET_PAYMENT_PROVIDER: NonNullable<ParsedEnv['TICKET_PAYMENT_PROVIDER']>;
};

export function readServerEnv(source: Record<string, unknown> = process.env): ServerEnv {
  const parsed = serverSchema.parse(source);
  const isProduction = source.NODE_ENV === 'production';
  return {
    ...parsed,
    TICKET_PAYMENT_PROVIDER:
      parsed.TICKET_PAYMENT_PROVIDER ?? (isProduction ? 'AMERIABANK' : 'FAKE'),
  };
}
