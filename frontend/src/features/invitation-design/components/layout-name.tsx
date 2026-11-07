import { useTranslation } from 'react-i18next';

/**
 * Layout names are the template's data, in English (FR-42). The ones the seeded templates and the
 * renderer use are worded in the page's language; any other is shown as it came, marked English.
 */
const KNOWN_LAYOUTS = [
  'full-bleed',
  'split',
  'stacked',
  'arch',
  'letter',
  'with-photo',
  'numerals',
  'days',
  'card',
  'cards',
  'list',
  'vertical',
  'compact',
  'editorial',
  'grid',
  'carousel',
] as const;
type KnownLayout = (typeof KNOWN_LAYOUTS)[number];

function isKnownLayout(layout: string): layout is KnownLayout {
  return (KNOWN_LAYOUTS as readonly string[]).includes(layout);
}

export function useLayoutName(): (layout: string) => { label: string; lang: string | undefined } {
  const { t } = useTranslation('design');
  return (layout) =>
    isKnownLayout(layout)
      ? { label: t(`layouts.${layout}`), lang: undefined }
      : { label: layout, lang: 'en' };
}
