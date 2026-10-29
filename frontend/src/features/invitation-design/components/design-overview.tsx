import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { BLOCK_TYPES, type BlockType } from '@/features/invitation-renderer';
import { BlockerList, readBlockers } from '@/features/sending';
import { StatusLine, usePageStatus } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import type { DesignData } from '../load';
import { designLookPath, designMediaPath, designPreviewPath, designQuestionsPath } from '../paths';
import { canRender } from '../payload';
import type { Design } from '../types';
import {
  DesignHeader,
  DesignRefusal,
  NoInvitation,
  TEXT_LINK,
  useSectionName,
} from './design-parts';
import { SectionList } from './section-list';
import { useSectionActions, type SectionActions } from './use-section-actions';

const SECTION_TITLE = 'm-0 text-lg font-medium';

/** What the invitation's state means for the edits made here. */
function DesignState({ design }: { design: Design }) {
  const { t } = useTranslation('design');
  return (
    <p className="m-0 max-w-[40rem]">
      {t(`overview.state.${design.status}`)} {design.status === 'DRAFT' ? null : t('overview.live')}
    </p>
  );
}

function Blockers({ design }: { design: Design }) {
  const { t } = useTranslation('design');
  if (design.status !== 'DRAFT' || design.publishBlockers.length === 0) return null;
  return (
    <section aria-labelledby="design-blockers" className="flex max-w-[40rem] flex-col gap-2">
      <h2 id="design-blockers" className={SECTION_TITLE}>
        {t('overview.blockersTitle')}
      </h2>
      <BlockerList blockers={readBlockers(design.publishBlockers)} eventId={design.event.id} />
    </section>
  );
}

/** Sections the template renders that the invitation lacks; the arrangement call adds one. */
function AddableSections({ design, actions }: { design: Design; actions: SectionActions }) {
  const { t } = useTranslation('design');
  const nameOf = useSectionName();
  const present = new Set(design.blocks.map((block) => block.type));
  const addable = BLOCK_TYPES.filter(
    (type: BlockType) => !present.has(type) && canRender(design.template, type),
  );
  if (addable.length === 0) return null;
  return (
    <section aria-labelledby="design-addable" className="flex max-w-[40rem] flex-col gap-2">
      <h2 id="design-addable" className={SECTION_TITLE}>
        {t('overview.addTitle')}
      </h2>
      <p className="text-muted-foreground m-0 text-sm">{t('overview.addLead')}</p>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {addable.map((type) => (
          <li key={type}>
            <Button
              variant="outline"
              disabled={actions.isBusy}
              onClick={() => void actions.add(type)}
            >
              {t('actionFor', { action: t('overview.add'), name: nameOf(type) })}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DesignLinks({ design }: { design: Design }) {
  const { t } = useTranslation('design');
  const eventId = design.event.id;
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild>
        <Link to={designPreviewPath(eventId)}>{t('nav.preview')}</Link>
      </Button>
      <Button asChild variant="outline">
        <Link to={designLookPath(eventId)}>{t('nav.look')}</Link>
      </Button>
      <Button asChild variant="outline">
        <Link to={designQuestionsPath(eventId)}>{t('nav.questions')}</Link>
      </Button>
      <Button asChild variant="outline">
        <Link to={designMediaPath(eventId)}>{t('nav.media')}</Link>
      </Button>
    </div>
  );
}

function Overview({ data, design }: { data: DesignData; design: Design }) {
  const { t } = useTranslation('design');
  const { page, status, statusRef } = usePageStatus(data);
  const actions = useSectionActions(design, page);
  return (
    <section className="flex flex-col gap-6">
      <DesignHeader
        eventId={design.event.id}
        back="event"
        title={t('overview.title')}
        subtitle={data.event.title}
      >
        <DesignState design={design} />
      </DesignHeader>
      <DesignLinks design={design} />
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      <Blockers design={design} />
      <p className="m-0">
        {t('overview.template', { name: design.template.name })}{' '}
        <Link to={designLookPath(design.event.id)} className={TEXT_LINK}>
          {t('overview.changeLook')}
        </Link>
      </p>
      <section aria-labelledby="design-sections" className="flex flex-col gap-3">
        <h2 id="design-sections" className={SECTION_TITLE}>
          {t('overview.sectionsTitle')}
        </h2>
        <p className="text-muted-foreground m-0 max-w-[40rem] text-sm">
          {t('overview.sectionsLead')}
        </p>
        {actions.refusal ? <DesignRefusal refusal={actions.refusal} /> : null}
        <SectionList design={design} actions={actions} page={page} />
      </section>
      <AddableSections design={design} actions={actions} />
    </section>
  );
}

/**
 * Designing the invitation (design PD-56): what still blocks publishing, the template, and the
 * page's sections in their order, each shown or hidden, moved, or opened to edit. Every action is
 * offered to every role, and a 403 is explained when it happens (FR-6).
 */
export function DesignOverview({ data }: { data: DesignData }) {
  if (!data.design) return <NoInvitation eventId={data.event.id} title={data.event.title} />;
  return <Overview data={data} design={data.design} />;
}
