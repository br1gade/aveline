import { describe, expect, it } from 'vitest';

import { supportContacts } from './contacts';

const NONE = {
  VITE_SUPPORT_EMAIL: '',
  VITE_SUPPORT_PHONE: '',
  VITE_SUPPORT_WHATSAPP: '',
  VITE_SUPPORT_TELEGRAM: '',
};

describe('supportContacts', () => {
  it('is empty when none is set', () => {
    expect(supportContacts(NONE)).toEqual([]);
  });

  it('lists what is set, in one order, each with where it leads', () => {
    expect(
      supportContacts({
        VITE_SUPPORT_EMAIL: 'help@example.am',
        VITE_SUPPORT_PHONE: '+37410123456',
        VITE_SUPPORT_WHATSAPP: '+37491123456',
        VITE_SUPPORT_TELEGRAM: 'aveline_help',
      }),
    ).toEqual([
      { kind: 'email', text: 'help@example.am', href: 'mailto:help@example.am' },
      { kind: 'phone', text: '+37410123456', href: 'tel:+37410123456' },
      { kind: 'whatsapp', text: '+37491123456', href: 'https://wa.me/37491123456' },
      { kind: 'telegram', text: '@aveline_help', href: 'https://t.me/aveline_help' },
    ]);
  });

  it('leaves out what isn’t set', () => {
    expect(supportContacts({ ...NONE, VITE_SUPPORT_TELEGRAM: 'aveline_help' })).toEqual([
      { kind: 'telegram', text: '@aveline_help', href: 'https://t.me/aveline_help' },
    ]);
  });
});
