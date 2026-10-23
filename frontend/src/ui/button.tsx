import type { ComponentProps } from 'react';

import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

/**
 * The design system's Button (DESIGN_SYSTEM §9, its Button README). Primary for the one main
 * action of a view, secondary beside it, quiet inside text or a card. On a Bordeaux surface the
 * `action` tokens switch to blush by themselves.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'min-h-(--control-height) px-6 border-action bg-action text-action-text hover:border-action-hover hover:bg-action-hover active:border-action-pressed active:bg-action-pressed',
  secondary:
    'min-h-(--control-height) px-6 border-action bg-transparent text-action hover:bg-surface-sunken active:border-action-pressed',
  quiet:
    'min-h-(--target-min) px-2 border-transparent bg-transparent text-action underline decoration-1 underline-offset-4 hover:decoration-2',
};

const BASE =
  'inline-flex items-center justify-center gap-2 border type-button-text uppercase transition-colors duration-150 cursor-pointer ' +
  'disabled:cursor-not-allowed disabled:border-sand disabled:bg-sand disabled:text-ink-muted ' +
  'aria-disabled:cursor-not-allowed aria-disabled:border-sand aria-disabled:bg-sand aria-disabled:text-ink-muted ' +
  'aria-busy:cursor-progress';

interface ButtonLook {
  variant?: ButtonVariant | undefined;
  /** Full width: in the reply bar and on phones. */
  isBlock?: boolean | undefined;
  className?: string | undefined;
}

export function buttonClass({ variant = 'primary', isBlock = false, className }: ButtonLook) {
  return cx(
    BASE,
    VARIANTS[variant],
    isBlock && 'w-full',
    variant !== 'quiet' && 'no-underline',
    className,
  );
}

type ButtonProps = ComponentProps<'button'> & ButtonLook;

export function Button({ variant, isBlock, className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={buttonClass({ variant, isBlock, className })} {...props} />;
}

type ButtonLinkProps = ComponentProps<'a'> & ButtonLook;

/** An anchor that looks like a button: for actions that go somewhere, such as directions. */
export function ButtonLink({ variant, isBlock, className, children, ...props }: ButtonLinkProps) {
  return (
    <a className={buttonClass({ variant, isBlock, className })} {...props}>
      {children}
    </a>
  );
}
