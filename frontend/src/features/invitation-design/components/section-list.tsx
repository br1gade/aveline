import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { PageActions } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { designSectionPath } from '../paths';
import { canRender, movableSections } from '../payload';
import type { Design, DesignBlock } from '../types';
import { isKnownBlock, useSectionName } from './design-parts';
import { HideReplyDialog } from './hide-reply-dialog';
import type { SectionActions } from './use-section-actions';

interface SectionListProps {
  design: Design;
  actions: SectionActions;
  page: PageActions;
}

interface RowProps {
  design: Design;
  block: DesignBlock;
  /** Its place among the sections the arrangement call accepts; `-1` when it cannot move. */
  place: { index: number; count: number };
  actions: SectionActions;
  onHideReply: () => void;
}

function MoveButtons({ block, place, actions }: Omit<RowProps, 'design' | 'onHideReply'>) {
  const { t } = useTranslation('design');
  const name = useSectionName()(block.type);
  if (place.index < 0 || place.count < 2) return null;
  return (
    <>
      {place.index > 0 ? (
        <Button
          variant="ghost"
          disabled={actions.isBusy}
          aria-label={t('actionFor', { action: t('overview.moveUp'), name })}
          onClick={() => void actions.move(block.type, -1)}
        >
          {t('overview.moveUp')}
        </Button>
      ) : null}
      {place.index < place.count - 1 ? (
        <Button
          variant="ghost"
          disabled={actions.isBusy}
          aria-label={t('actionFor', { action: t('overview.moveDown'), name })}
          onClick={() => void actions.move(block.type, 1)}
        >
          {t('overview.moveDown')}
        </Button>
      ) : null}
    </>
  );
}

/** Show is offered only where the template can render it; Hide always is. */
function VisibilityButton({ design, block, actions, onHideReply }: Omit<RowProps, 'place'>) {
  const { t } = useTranslation('design');
  const name = useSectionName()(block.type);
  if (!block.enabled && !canRender(design.template, block.type)) return null;
  const action = t(block.enabled ? 'overview.hide' : 'overview.show');
  // Hiding the reply section of a page guests already hold asks first.
  const isAsking = block.enabled && block.type === 'RSVP' && design.status !== 'DRAFT';
  const press = () =>
    isAsking ? onHideReply() : void actions.setShown(block.type, !block.enabled);
  return (
    <Button
      variant="outline"
      disabled={actions.isBusy}
      aria-label={t('actionFor', { action, name })}
      onClick={press}
    >
      {action}
    </Button>
  );
}

function SectionRow(props: RowProps) {
  const { t } = useTranslation('design');
  const { design, block } = props;
  const name = useSectionName()(block.type);
  const isKnown = isKnownBlock(block.type);
  return (
    <li className="bg-card border-border flex flex-col gap-2 border px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="m-0 text-base font-medium break-words" lang={isKnown ? undefined : 'en'}>
          {name}
        </h3>
        <p className="text-muted-foreground m-0 text-sm">
          {t(block.enabled ? 'overview.isShown' : 'overview.isHidden')}
        </p>
      </div>
      {isKnown ? null : (
        <p className="text-muted-foreground m-0 text-sm">{t('overview.unknown')}</p>
      )}
      {isKnown && !canRender(design.template, block.type) ? (
        <p className="text-muted-foreground m-0 text-sm">{t('overview.cannotShow')}</p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {isKnown ? (
          <Button asChild variant="outline">
            <Link
              to={designSectionPath(design.event.id, block.type)}
              aria-label={t('actionFor', { action: t('overview.edit'), name })}
            >
              {t('overview.edit')}
            </Link>
          </Button>
        ) : null}
        {isKnown ? <VisibilityButton {...props} /> : null}
        <MoveButtons {...props} />
      </div>
    </li>
  );
}

/**
 * The invitation's sections in page order, switched-off ones included, never sorted (docs/API.md
 * §6; design PD-56). Moving sends the whole order of the sections the template renders; the
 * others follow at the end, as the backend places them.
 */
export function SectionList({ design, actions, page }: SectionListProps) {
  const [isAskingReply, setIsAskingReply] = useState(false);
  const movable: readonly string[] = movableSections(design.blocks, design.template);
  return (
    <>
      <ol className="m-0 flex max-w-[40rem] list-none flex-col gap-3 p-0">
        {design.blocks.map((block) => (
          <SectionRow
            key={block.type}
            design={design}
            block={block}
            place={{ index: movable.indexOf(block.type), count: movable.length }}
            actions={actions}
            onHideReply={() => setIsAskingReply(true)}
          />
        ))}
      </ol>
      {isAskingReply ? (
        <HideReplyDialog slug={design.slug} page={page} onClose={() => setIsAskingReply(false)} />
      ) : null}
    </>
  );
}
