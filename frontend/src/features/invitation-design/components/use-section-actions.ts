import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { problemFrom } from '@/api/problems';
import { browserSession } from '@/api/session';
import type { BlockType } from '@/features/invitation-renderer';
import type { PageActions } from '@/ui/app-form';

import { arrangeSections, updateSection } from '../api';
import { addSectionArrangement, moveSectionArrangement } from '../payload';
import { isStaleRefusal, type DesignAction } from '../refusals';
import type { Design } from '../types';
import { useSectionName, type DesignRefusalState } from './design-parts';

/**
 * Showing, hiding, moving and adding sections (design PD-56): one request each, then the page
 * reloads and its status line says what happened, with the focus, since the button pressed may
 * have moved or gone. A refusal the page is out of date behind reloads it under the message.
 */
export function useSectionActions(design: Design, page: PageActions) {
  const { t } = useTranslation('design');
  const nameOf = useSectionName();
  const [refusal, setRefusal] = useState<DesignRefusalState | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const run = async (action: DesignAction, call: () => Promise<void>, message: string) => {
    setRefusal(null);
    setIsBusy(true);
    try {
      await call();
      await page.done(message);
    } catch (error) {
      setRefusal({ action, problem: problemFrom(error) });
      if (isStaleRefusal(action, error)) page.reload();
    } finally {
      setIsBusy(false);
    }
  };
  const { slug } = design;

  const setShown = (type: string, isShown: boolean) =>
    run(
      'show',
      () => updateSection(browserSession().api, slug, type, { enabled: isShown }),
      t(isShown ? 'overview.shownStatus' : 'overview.hiddenStatus', { name: nameOf(type) }),
    );
  const move = (type: string, direction: -1 | 1) => {
    const body = moveSectionArrangement(design.blocks, design.template, type, direction);
    if (!body) return Promise.resolve();
    const message = t(direction < 0 ? 'overview.movedUp' : 'overview.movedDown', {
      name: nameOf(type),
    });
    return run('move', () => arrangeSections(browserSession().api, slug, body), message);
  };
  const add = (type: BlockType) =>
    run(
      'add',
      () =>
        arrangeSections(
          browserSession().api,
          slug,
          addSectionArrangement(design.blocks, design.template, type),
        ),
      t('overview.addedStatus', { name: nameOf(type) }),
    );
  return { refusal, isBusy, setShown, move, add };
}

export type SectionActions = ReturnType<typeof useSectionActions>;
