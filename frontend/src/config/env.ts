import { z } from 'zod';

/**
 * Public configuration, compiled into the browser bundle: never a secret (setup proposal §5.12).
 * Validated where it is read, so a wrong value fails loudly rather than misbehaving, in the spirit
 * of backend/src/config/env.validation.ts.
 */
const publicSchema = z.object({
  /** The API origin for browser calls. Empty means the page's own origin (the Vite proxy, Caddy). */
  VITE_API_BASE_URL: z.string().default(''),
  /** This client's public origin, for return URLs handed to a bank. */
  VITE_PUBLIC_ORIGIN: z.url().default('http://localhost:5173'),
  /** Where uploaded media is served from; it goes into the Content Security Policy. */
  VITE_MEDIA_BASE_URL: z.string().default(''),
});

export type PublicEnv = z.infer<typeof publicSchema>;

export function readPublicEnv(source: Record<string, unknown> = import.meta.env): PublicEnv {
  return publicSchema.parse(source);
}
