import { useTranslation } from 'react-i18next';

/**
 * The host's suggested colours as square fabric samples (spec §5, DRESS_CODE). Decoration: hex
 * values cannot be named in words, so the row is one image labelled "Suggested colours" and the
 * text carries the guidance (PD-26).
 */
export function Swatches({ colours }: { colours: string[] }) {
  const { t } = useTranslation('invitation');
  if (colours.length === 0) return null;
  return (
    <div role="img" aria-label={t('dressCode.swatches')} className="flex flex-wrap gap-2">
      {colours.map((colour, index) => (
        <span
          key={`${index}-${colour}`}
          className="border-control-edge size-9 border"
          style={{ backgroundColor: colour }}
        />
      ))}
    </div>
  );
}
