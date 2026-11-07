import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui';

interface PhotoViewerProps {
  /** The photo's name, for the dialog. */
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/** The browser's own close, which fires `close`; where there is none (jsdom), the page's. */
function closeDialog(dialog: HTMLDialogElement | null, onClose: () => void) {
  if (dialog && typeof dialog.close === 'function') dialog.close();
  else onClose();
}

/**
 * A photo larger, in the browser's own modal dialog: the invitation does not use the app's kit
 * (ARCHITECTURE §8). Escape and Close close it; the focus goes back where it was.
 */
export function PhotoViewer({ label, onClose, children }: PhotoViewerProps) {
  const { t } = useTranslation('gallery');
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
    else dialog?.setAttribute('open', '');
    return () => opener?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={onClose}
      className="bg-surface text-text m-auto max-h-[94svh] w-[min(94vw,64rem)] border-0 p-0 backdrop:bg-black/80"
    >
      <div className="flex flex-col gap-3 p-3 sm:p-4">
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => closeDialog(ref.current, onClose)}>
            {t('viewer.close')}
          </Button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
