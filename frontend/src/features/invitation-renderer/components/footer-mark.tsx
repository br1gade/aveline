import { useTranslation } from 'react-i18next';

/** The supplied logo file, unchanged (public/brand/ holds a byte-identical copy). */
export const LOGO_SRC = '/brand/aveline-events-logo.png';

/**
 * The Aveline Events logo, once, at the foot of the invitation (C-12, PD-1). The file's ground is
 * exactly `brand-burgundy`, so on a burgundy band it shows no edge; CSS crops it to the lockup and
 * one cap height of clear space (source box x 668–3966, y 1984–3456 of 4500 × 5625). Not a link
 * (PD-19). Lazy, because it is 166 KB until a web export exists (DQ-1).
 */
export function FooterMark() {
  const { t } = useTranslation('invitation');
  return (
    <footer className="bg-brand-burgundy flex justify-center px-5 py-12">
      <div className="relative aspect-[3298/1472] w-[220px] min-w-[182px] overflow-hidden">
        <img
          src={LOGO_SRC}
          alt={t('footer.logo')}
          width={4500}
          height={5625}
          loading="lazy"
          decoding="async"
          className="absolute top-[-134.78%] left-[-20.255%] h-auto w-[136.446%] max-w-none"
        />
      </div>
    </footer>
  );
}
