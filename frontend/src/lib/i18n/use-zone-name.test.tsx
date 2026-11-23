import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';

import { createI18n, type Language } from './i18n';
import { useZoneName } from './use-zone-name';

function zoneNameIn(language: Language) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={createI18n(language)}>{children}</I18nextProvider>
  );
  return renderHook(() => useZoneName(), { wrapper }).result.current;
}

describe('useZoneName (audit 20 Nov, A2-14)', () => {
  it.each([
    ['ru', 'Asia/Yerevan', 'Ереван'],
    ['hy', 'Asia/Yerevan', 'Երևան'],
    ['en', 'Europe/Moscow', 'Moscow'],
  ] as const)(
    'names a city Aveline knows in the page’s language: %s, %s',
    (language, zone, name) => {
      expect(zoneNameIn(language)(zone)).toBe(name);
    },
  );

  it('keeps any other zone’s IANA name, its underscores as spaces', () => {
    expect(zoneNameIn('ru')('America/New_York')).toBe('America/New York');
  });
});
