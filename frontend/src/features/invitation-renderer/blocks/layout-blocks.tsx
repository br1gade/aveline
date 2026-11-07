import { useTranslation } from 'react-i18next';

import { cx, Notice, SectionHeading } from '@/ui';

import { useInvitation } from '../context';
import { Cover } from '../components/cover';
import { REPLY_HEADING_ID, REPLY_SECTION_ID } from '../components/reply-summary';
import { COLUMN, GUTTERS } from '../components/section';
import { bodyContent } from '../schemas';
import type { BlockProps } from './block-props';

/**
 * A HERO that is not the first block renders in place as a wide band (spec §5). The first one is
 * the page's cover and is placed by the page; any later HERO renders nothing, so the page keeps
 * one h1.
 */
export function HeroBlock({ block, index }: BlockProps) {
  const { invitation } = useInvitation();
  const firstHero = invitation.blocks.findIndex((candidate) => candidate.type === 'HERO');
  if (index === 0 || index !== firstHero) return null;
  return (
    <section
      data-theme="bordeaux"
      className={cx(GUTTERS, 'bg-surface text-text mt-16 pb-16 lg:mt-24')}
    >
      <Cover block={block} className={COLUMN} />
    </section>
  );
}

/**
 * The reply section's heading, and the host's own line under it. Once a reply is sent, "Thank
 * you" replaces both (PD-36).
 */
function ReplyHeading({ block }: BlockProps) {
  const { t } = useTranslation('invitation');
  const { replyHeading } = useInvitation();
  const { title, body } = bodyContent(block);
  if (replyHeading) {
    return <SectionHeading id={REPLY_HEADING_ID} heading={replyHeading} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <SectionHeading
        id={REPLY_HEADING_ID}
        label={t('reply.label')}
        heading={title ?? t('reply.heading')}
      />
      {body ? <p className="text-text-muted m-0 whitespace-pre-line">{body}</p> : null}
    </div>
  );
}

/** Under the heading: the form, or why there is none. */
function ReplyBody({ block }: Pick<BlockProps, 'block'>) {
  const { t } = useTranslation('invitation');
  const { invitation, renderReply } = useInvitation();
  const isOpen = invitation.isAcceptingResponses;
  // A host's preview is never open and has no guest; it says what guests get instead (PD-59).
  if (invitation.isPreview) return <Notice>{t('reply.preview')}</Notice>;
  return (
    <>
      {isOpen ? null : <Notice>{t('reply.closed')}</Notice>}
      {invitation.guest ? renderReply?.(block) : null}
      {!invitation.guest && isOpen ? <p className="m-0">{t('reply.generic')}</p> : null}
    </>
  );
}

/**
 * The reply band (spec §4.5): a burgundy section wherever the host placed the RSVP block. The form
 * itself comes from the route through `renderReply`, on a light card, because the error and
 * success colours pass only there. The generic link cannot reply: it says how to.
 */
export function ReplyBlock({ block, index }: BlockProps) {
  return (
    <section
      id={REPLY_SECTION_ID}
      data-theme="bordeaux"
      className={cx(GUTTERS, 'bg-surface text-text mt-20 py-16 lg:mt-24 lg:py-24')}
    >
      <div className={cx(COLUMN, 'flex flex-col gap-6')}>
        <ReplyHeading block={block} index={index} />
        <ReplyBody block={block} />
      </div>
    </section>
  );
}
