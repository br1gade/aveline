import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { BLOCK_EDITING, type BlockType } from '@/features/invitation-renderer';
import { StatusLine, usePageStatus, type PageActions } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import type { DesignSectionData } from '../load';
import { designLookPath, venuesPath } from '../paths';
import { canRender } from '../payload';
import type { Design, DesignBlock } from '../types';
import {
  DesignHeader,
  DesignRefusal,
  isKnownBlock,
  NoInvitation,
  TEXT_LINK,
  useSectionName,
} from './design-parts';
import { HideReplyDialog } from './hide-reply-dialog';
import { SectionForm } from './section-form';
import { useSectionActions } from './use-section-actions';

interface SectionProps {
  data: DesignSectionData;
  design: Design;
  page: PageActions;
}

/** Shown or hidden, and the button that changes it, as on the overview. */
function Visibility({ design, block, page }: Omit<SectionProps, 'data'> & { block: DesignBlock }) {
  const { t } = useTranslation('design');
  const actions = useSectionActions(design, page);
  const [isAskingReply, setIsAskingReply] = useState(false);
  const isRenderable = canRender(design.template, block.type);
  const isAsking = block.enabled && block.type === 'RSVP' && design.status !== 'DRAFT';
  const press = () =>
    isAsking ? setIsAskingReply(true) : void actions.setShown(block.type, !block.enabled);
  return (
    <div className="flex flex-col gap-2">
      {actions.refusal ? <DesignRefusal refusal={actions.refusal} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <p className="m-0">{t(block.enabled ? 'section.isShown' : 'section.isHidden')}</p>
        {block.enabled || isRenderable ? (
          <Button variant="outline" disabled={actions.isBusy} onClick={press}>
            {t(block.enabled ? 'overview.hide' : 'overview.show')}
          </Button>
        ) : null}
      </div>
      {isRenderable ? null : (
        <p className="text-muted-foreground m-0 text-sm">
          {t('section.cannotShow', { template: design.template.name })}{' '}
          <Link to={designLookPath(design.event.id)} className={TEXT_LINK}>
            {t('section.chooseTemplate')}
          </Link>
        </p>
      )}
      {isAskingReply ? (
        <HideReplyDialog slug={design.slug} page={page} onClose={() => setIsAskingReply(false)} />
      ) : null}
    </div>
  );
}

/** A section the invitation lacks: added at the end through the arrangement call, if it can be. */
function MissingSection({ design, page, type }: Omit<SectionProps, 'data'> & { type: BlockType }) {
  const { t } = useTranslation('design');
  const actions = useSectionActions(design, page);
  if (!canRender(design.template, type)) {
    return (
      <p className="m-0">
        {t('section.cannotShow', { template: design.template.name })}{' '}
        <Link to={designLookPath(design.event.id)} className={TEXT_LINK}>
          {t('section.chooseTemplate')}
        </Link>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {actions.refusal ? <DesignRefusal refusal={actions.refusal} /> : null}
      <p className="m-0">{t('section.missing')}</p>
      <Button
        className="self-start"
        disabled={actions.isBusy}
        onClick={() => void actions.add(type)}
      >
        {t('section.add')}
      </Button>
    </div>
  );
}

/** Where the facts of a data-bound section come from: they are the event's, not its copy. */
function DataNote({ type, eventId }: { type: BlockType; eventId: string }) {
  const { t } = useTranslation('design');
  const { data } = BLOCK_EDITING[type];
  if (!data) return null;
  return (
    <p className="text-muted-foreground m-0 text-sm">
      {t(`section.data.${data}`)}{' '}
      {data === 'venues' ? (
        <Link to={venuesPath(eventId)} className={TEXT_LINK}>
          {t('section.data.venuesLink')}
        </Link>
      ) : null}
    </p>
  );
}

function SectionBody({ data, design, page }: SectionProps) {
  const { t } = useTranslation('design');
  const { type } = data;
  if (!isKnownBlock(type)) return <p className="m-0">{t('section.unknown')}</p>;
  const block = design.blocks.find((candidate) => candidate.type === type);
  if (!block) return <MissingSection design={design} page={page} type={type} />;
  const template =
    data.templates.kind === 'ready'
      ? data.templates.value.find((candidate) => candidate.key === design.template.key)
      : undefined;
  return (
    <>
      <Visibility design={design} block={block} page={page} />
      <DataNote type={type} eventId={design.event.id} />
      <SectionForm
        design={design}
        block={block}
        editing={BLOCK_EDITING[type]}
        layouts={template ? (template.blockVariants[type] ?? []) : null}
        library={data.library}
        page={page}
      />
    </>
  );
}

function SectionPage({ data, design }: Omit<SectionProps, 'page'>) {
  const { t } = useTranslation('design');
  const { page, status, statusRef } = usePageStatus(data);
  const name = useSectionName()(data.type);
  return (
    <section className="flex max-w-[40rem] flex-col gap-5">
      <DesignHeader
        eventId={design.event.id}
        back="design"
        title={name}
        subtitle={data.event.title}
      >
        {isKnownBlock(data.type) ? <p className="m-0">{t(`blocks.${data.type}.about`)}</p> : null}
      </DesignHeader>
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      <SectionBody data={data} design={design} page={page} />
    </section>
  );
}

/**
 * One section of the invitation (design PD-57): whether guests see it, its layout, and its words in
 * each of the event's languages, with its colours or media where it shows them.
 */
export function DesignSection({ data }: { data: DesignSectionData }) {
  if (!data.design) return <NoInvitation eventId={data.event.id} title={data.event.title} />;
  return <SectionPage data={data} design={data.design} />;
}
