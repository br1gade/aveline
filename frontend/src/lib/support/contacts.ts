import type { PublicEnv } from '@/config/env';

export type SupportKind = 'email' | 'phone' | 'whatsapp' | 'telegram';

export interface SupportContact {
  kind: SupportKind;
  /** As shown: the address, the number as written, or the Telegram name with its `@`. */
  text: string;
  href: string;
}

type SupportSettings = Pick<
  PublicEnv,
  'VITE_SUPPORT_EMAIL' | 'VITE_SUPPORT_PHONE' | 'VITE_SUPPORT_WHATSAPP' | 'VITE_SUPPORT_TELEGRAM'
>;

/**
 * The ways to reach Aveline that are set (design C-54), in one order: email, phone, WhatsApp, then
 * Telegram. The settings are checked when read (`config/env.ts`), so each is in its expected shape.
 */
export function supportContacts(env: SupportSettings): SupportContact[] {
  const email = env.VITE_SUPPORT_EMAIL;
  const phone = env.VITE_SUPPORT_PHONE;
  const whatsapp = env.VITE_SUPPORT_WHATSAPP;
  const telegram = env.VITE_SUPPORT_TELEGRAM;
  const contacts: Array<SupportContact | null> = [
    email ? { kind: 'email', text: email, href: `mailto:${email}` } : null,
    phone ? { kind: 'phone', text: phone, href: `tel:${phone}` } : null,
    whatsapp
      ? { kind: 'whatsapp', text: whatsapp, href: `https://wa.me/${whatsapp.slice(1)}` }
      : null,
    telegram ? { kind: 'telegram', text: `@${telegram}`, href: `https://t.me/${telegram}` } : null,
  ];
  return contacts.filter((contact) => contact !== null);
}
