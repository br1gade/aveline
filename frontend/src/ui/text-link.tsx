import type { AnchorHTMLAttributes, ReactNode } from 'react';

import { cx } from './cx';
import { Icon } from './icon';

interface TextLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'target' | 'rel'> {
  href: string;
  children: ReactNode;
  /** Leaves the site: a new tab, no referrer, and the external-link icon (design C-18). */
  isExternal?: boolean;
}

/** The design system's Link: `action` colour, a 1 px underline that thickens on hover. */
export function TextLink({ isExternal = false, className, children, ...props }: TextLinkProps) {
  return (
    <a
      className={cx(
        'text-action underline decoration-1 underline-offset-3 hover:decoration-2',
        className,
      )}
      {...(isExternal ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      {...props}
    >
      {children}
      {isExternal ? (
        <Icon name="external-link" size={16} className="ml-1 inline align-[-3px]" />
      ) : null}
    </a>
  );
}

/** Attributes for any link that leaves the site (design C-18). */
export const EXTERNAL_LINK = { target: '_blank', rel: 'noreferrer noopener' } as const;
