import { z } from 'zod';

import { isEmailShaped } from '@/lib/text';

/**
 * Public configuration, compiled into the browser bundle: never a secret (setup proposal §5.12).
 * Validated where it is read, so a wrong value fails loudly rather than misbehaving, in the spirit
 * of backend/src/config/env.validation.ts.
 */
const INTERNATIONAL_PHONE = /^\+[1-9]\d{6,14}$/;
const TELEGRAM_NAME = /^[A-Za-z0-9_]{5,32}$/;

function isWebAddress(value: string): boolean {
  return URL.canParse(value) && ['https:', 'http:'].includes(new URL(value).protocol);
}

/** A setting that may be left empty, and is checked when it is not. */
function optional(isValid: (value: string) => boolean) {
  return z
    .string()
    .trim()
    .refine((value) => value === '' || isValid(value))
    .default('');
}

const publicSchema = z.object({
  /** The API origin for browser calls. Empty means the page's own origin (the Vite proxy, Caddy). */
  VITE_API_BASE_URL: z.string().default(''),
  /**
   * This client's public origin, for return URLs handed to a bank and the brief links hosts send.
   * Must be set for production: the default is the development server's (a brief link built on
   * it is refused, `features/vendors/brief-link.ts`).
   */
  VITE_PUBLIC_ORIGIN: z.url().default('http://localhost:5173'),
  /** Where uploaded media is served from; it goes into the Content Security Policy. */
  VITE_MEDIA_BASE_URL: z.string().default(''),
  /**
   * How customers reach Aveline (design C-54): each one shown where it is set, on the Help page, the
   * price list and the two payment errors. Empty is not shown; a malformed one stops the build.
   */
  VITE_SUPPORT_EMAIL: optional((value) => isEmailShaped(value)),
  /** A phone number in international form, such as `+37410123456`. */
  VITE_SUPPORT_PHONE: optional((value) => INTERNATIONAL_PHONE.test(value)),
  /** The WhatsApp number, in the same form. */
  VITE_SUPPORT_WHATSAPP: optional((value) => INTERNATIONAL_PHONE.test(value)),
  /** A Telegram username, without the `@`. */
  VITE_SUPPORT_TELEGRAM: optional((value) => TELEGRAM_NAME.test(value)),
  /** Aveline's website, which the footer mark links to once it is set (design C-35). */
  VITE_SITE_URL: optional(isWebAddress),
});

export type PublicEnv = z.infer<typeof publicSchema>;

export function readPublicEnv(source: Record<string, unknown> = import.meta.env): PublicEnv {
  return publicSchema.parse(source);
}
