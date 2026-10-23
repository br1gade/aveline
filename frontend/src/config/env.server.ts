import { z } from 'zod';

/**
 * Configuration for the rendering server only. The `.server` suffix keeps it out of the browser
 * bundle.
 */
const serverSchema = z.object({
  /** Where server loaders reach the API: the internal network, not the public origin. */
  API_INTERNAL_URL: z.url().default('http://localhost:3000'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

export function readServerEnv(source: Record<string, unknown> = process.env): ServerEnv {
  return serverSchema.parse(source);
}
