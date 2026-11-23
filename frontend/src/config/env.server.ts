import { z } from 'zod';

/**
 * Configuration for the rendering server only. The `.server` suffix keeps it out of the browser
 * bundle. The bank a paid order or plan goes to is the API's answer (`GET /payment-options`,
 * FR-64, FR-109), not a setting here.
 */
const serverSchema = z.object({
  /** Where server loaders reach the API: the internal network, not the public origin. */
  API_INTERNAL_URL: z.url().default('http://localhost:3000'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

export function readServerEnv(source: Record<string, unknown> = process.env): ServerEnv {
  return serverSchema.parse(source);
}
