import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { problemFrom } from '@/api/problems';
import { browserSession } from '@/api/session';
import type { PageActions } from '@/ui/app-form';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/kit/alert-dialog';
import { Button } from '@/ui/kit/button';

import { chooseTemplate } from '../api';
import { isStaleRefusal } from '../refusals';
import { switchEffects } from '../template-switch';
import type { Design, DesignTemplate, Theme } from '../types';
import { DesignRefusal, useSectionName, type DesignRefusalState } from './design-parts';

interface SwitchProps {
  design: Design;
  target: DesignTemplate;
  page: PageActions;
  onClose: () => void;
}

function lookOf(theme: Theme): string {
  return [theme.headingFont, theme.bodyFont, theme.palette].filter(Boolean).join(', ');
}

/** What changes, said before it does (docs/API.md §6: "Warn before calling it"). */
function Effects({ design, target }: Pick<SwitchProps, 'design' | 'target'>) {
  const { t } = useTranslation('design');
  const nameOf = useSectionName();
  const effects = switchEffects(design.blocks, target);
  const names = (types: readonly string[]) => types.map(nameOf).join(', ');
  const look = lookOf(target.defaultTheme);
  return (
    <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
      <li>{look ? t('switch.look', { look }) : t('switch.lookPlain')}</li>
      {effects.hidden.length > 0 ? (
        <li>{t('switch.hidden', { sections: names(effects.hidden) })}</li>
      ) : null}
      {effects.layoutsReset.length > 0 ? (
        <li>{t('switch.layouts', { sections: names(effects.layoutsReset) })}</li>
      ) : null}
      {effects.missing.length > 0 ? (
        <li>{t('switch.missing', { sections: names(effects.missing) })}</li>
      ) : null}
      <li>{t('switch.kept')}</li>
    </ul>
  );
}

/**
 * Choosing another template (design PD-58), after a confirmation that lists what it changes. The
 * press is a plain button, so the dialog stays open while the request runs and can show a refusal.
 */
export function SwitchTemplateDialog({ design, target, page, onClose }: SwitchProps) {
  const { t } = useTranslation('design');
  const [isSwitching, setIsSwitching] = useState(false);
  const [refusal, setRefusal] = useState<DesignRefusalState | null>(null);
  const isDoneRef = useRef(false);

  const confirm = async () => {
    setRefusal(null);
    setIsSwitching(true);
    try {
      await chooseTemplate(browserSession().api, design.slug, target.key);
      await page.done(t('switch.done', { name: target.name }));
      isDoneRef.current = true;
      onClose();
    } catch (error) {
      setRefusal({ action: 'template', problem: problemFrom(error) });
      setIsSwitching(false);
      if (isStaleRefusal('template', error)) page.reload();
    }
  };

  return (
    <AlertDialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <AlertDialogContent
        onCloseAutoFocus={(closing) => (isDoneRef.current ? page.focusStatus(closing) : undefined)}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('switch.title', { name: target.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t('switch.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <Effects design={design} target={target} />
        {refusal ? <DesignRefusal refusal={refusal} /> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>
            {t('switch.cancel', { name: design.template.name })}
          </AlertDialogCancel>
          <Button disabled={isSwitching} onClick={() => void confirm()}>
            {isSwitching ? t('switch.switching') : t('switch.confirm', { name: target.name })}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
