import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Language } from '@/lib/i18n';
import { ButtonLink, cx, StatusChip } from '@/ui';

import { blockComponent } from './blocks/registry';
import { InvitationProvider, useInvitation } from './context';
import { Cover } from './components/cover';
import { FooterMark } from './components/footer-mark';
import { LanguageSwitcher } from './components/language-switcher';
import { FloatingPause, MusicControl, MusicProvider } from './components/music';
import { PersonalCard } from './components/personal-card';
import { ReplyBar, useVisibility } from './components/reply-bar';
import {
  REPLY_HEADING_ID,
  REPLY_SECTION_ID,
  replyFromInvitation,
  type ReplySummary,
} from './components/reply-summary';
import { COLUMN, GUTTERS } from './components/section';
import { useStatusText } from './components/status-text';
import { invitationPalette } from './theme';
import type { Invitation, InvitationBlock } from './types';

/** The personal card's Reply, watched by the reply bar (PD-31). */
const CARD_REPLY_ID = 'personal-reply';

export interface InvitationPageProps {
  invitation: Invitation;
  /** The guest's reply as the route knows it; defaults to the invitation's own `guest.rsvp`. */
  reply?: ReplySummary | null | undefined;
  /** Fills the reply section on personal links. */
  renderReply?: ((block: InvitationBlock) => ReactNode) | undefined;
  /** The page in another language, for the switcher (R-17). */
  languageHref?: ((language: Language) => string) | undefined;
  /** Replaces the reply section's heading: "Thank you" once a reply is sent (PD-36). */
  replyHeading?: string | undefined;
}

function TopBar({ languageHref }: Pick<InvitationPageProps, 'languageHref'>) {
  const { invitation } = useInvitation();
  return (
    <div className="flex h-11 items-center justify-between gap-3">
      {languageHref ? (
        <LanguageSwitcher
          current={invitation.locale}
          available={invitation.availableLocales}
          hrefFor={languageHref}
        />
      ) : (
        <span />
      )}
      <MusicControl />
    </div>
  );
}

/** Under the date on the desktop cover: Reply, then the reply's status once its section is in view. */
function CoverReply({ reply }: { reply: ReplySummary | null }) {
  const { t } = useTranslation('invitation');
  const statusText = useStatusText(reply);
  // The button until the reply section is known to be on screen (PD-31).
  const isSectionInView = useVisibility([REPLY_SECTION_ID]) === 'some';
  if (reply && statusText && isSectionInView) {
    return <StatusChip status={reply.status}>{statusText}</StatusChip>;
  }
  return (
    <ButtonLink href={`#${REPLY_HEADING_ID}`} isBlock>
      {reply ? t('personal.changeReply') : t('personal.reply')}
    </ButtonLink>
  );
}

function SkipToReply() {
  const { t } = useTranslation('invitation');
  return (
    <a
      href={`#${REPLY_HEADING_ID}`}
      className="bg-porcelain text-ink sr-only px-4 py-3 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-40"
    >
      {t('reply.skip')}
    </a>
  );
}

interface LayoutProps {
  invitation: Invitation;
  reply: ReplySummary | null;
  languageHref: InvitationPageProps['languageHref'];
}

function Letter({ blocks }: { blocks: InvitationBlock[] }) {
  return blocks.map((block, index) => {
    const Block = blockComponent(block.type);
    return Block ? <Block key={`${index}-${block.type}`} block={block} index={index} /> : null;
  });
}

/** Whether the page can take a reply here: a personal link, replies open, and a reply section. */
function canReply(invitation: Invitation): boolean {
  return (
    Boolean(invitation.guest) &&
    invitation.isAcceptingResponses &&
    invitation.blocks.some((block) => block.type === 'RSVP')
  );
}

/** HERO first: the cover is the header, on top on phones and pinned left from 1024 px. */
function CoverHeader({ cover, reply, languageHref }: LayoutProps & { cover: InvitationBlock }) {
  const { invitation } = useInvitation();
  const action = canReply(invitation) ? (
    <div className="hidden lg:block">
      <CoverReply reply={reply} />
    </div>
  ) : null;
  return (
    <header
      data-theme="bordeaux"
      className="bg-surface text-text flex flex-col px-5 pt-4 pb-18 lg:sticky lg:top-0 lg:row-span-2 lg:h-svh lg:overflow-y-auto lg:px-12 lg:pb-12"
    >
      <TopBar languageHref={languageHref} />
      <div className="flex flex-auto flex-col justify-center">
        <Cover block={cover} action={action} />
      </div>
    </header>
  );
}

function PlainHeader({ languageHref }: Pick<LayoutProps, 'languageHref'>) {
  return (
    <header className={GUTTERS}>
      <div className={cx(COLUMN, 'pt-4')}>
        <TopBar languageHref={languageHref} />
      </div>
    </header>
  );
}

/** On phones the card overlaps the cover by 32 px, like a card tucked into a folder (spec §4.3). */
function PersonalCardSlot({ reply, hasCover }: { reply: ReplySummary | null; hasCover: boolean }) {
  const { invitation } = useInvitation();
  if (!invitation.guest) return null;
  return (
    <div className={cx(GUTTERS, 'relative', hasCover ? '-mt-8 lg:mt-16' : 'mt-8')}>
      <PersonalCard
        guest={invitation.guest}
        reply={reply}
        replyButtonId={CARD_REPLY_ID}
        className={cx(COLUMN, hasCover && 'shadow-(--shadow-card) lg:shadow-none')}
      />
    </div>
  );
}

/**
 * The page (spec §4, §8). With HERO first, the cover is the header, and from 1024 px the open
 * card: the cover pinned in the left 5/12, the letter scrolling on the right. Otherwise one
 * centred column with the cover in place.
 */
function Layout({ invitation, reply, languageHref }: LayoutProps) {
  const cover = invitation.blocks[0]?.type === 'HERO' ? invitation.blocks[0] : undefined;
  const isBarWanted = canReply(invitation);
  const isNothingInView =
    useVisibility(isBarWanted ? [REPLY_SECTION_ID, CARD_REPLY_ID] : []) === 'none';
  const hasReplySection = invitation.blocks.some((block) => block.type === 'RSVP');

  return (
    <>
      {hasReplySection ? <SkipToReply /> : null}
      <div
        className={cx(
          'bg-surface text-text min-h-svh [--letter-column:34rem] sm:[--letter-column:36rem] md:[--letter-column:40rem]',
          cover
            ? 'lg:grid lg:grid-cols-[clamp(420px,41.6667%,640px)_minmax(0,1fr)] lg:[--letter-column:42rem]'
            : 'lg:[--letter-column:44rem]',
        )}
      >
        {cover ? (
          <CoverHeader
            cover={cover}
            invitation={invitation}
            reply={reply}
            languageHref={languageHref}
          />
        ) : (
          <PlainHeader languageHref={languageHref} />
        )}
        {/* 80 px before the footer, unless the letter already ends on a burgundy band. */}
        <main className="min-w-0 pb-20 has-[>section[data-theme=bordeaux]:last-child]:pb-0 lg:pb-24">
          <PersonalCardSlot reply={reply} hasCover={Boolean(cover)} />
          <Letter blocks={invitation.blocks} />
        </main>
        <FooterMark />
      </div>
      {isBarWanted ? <ReplyBar reply={reply} isShown={isNothingInView} /> : null}
      <FloatingPause />
    </>
  );
}

/**
 * The guest invitation, rendered from the payload alone (spec §3). Blocks in the order given, never
 * sorted; unknown types render nothing (C-15). Every time in the event's zone (C-16).
 */
export function InvitationPage({
  invitation,
  reply,
  renderReply,
  languageHref,
  replyHeading,
}: InvitationPageProps) {
  const zone = { timeZone: invitation.event.timezone, locale: invitation.locale };
  const palette = invitationPalette(invitation.theme);
  const summary = reply === undefined ? replyFromInvitation(invitation) : reply;
  return (
    <InvitationProvider value={{ invitation, zone, renderReply, replyHeading }}>
      <MusicProvider url={invitation.musicUrl}>
        <div data-palette={palette.name} data-theme={palette.letterTheme}>
          <Layout invitation={invitation} reply={summary} languageHref={languageHref} />
        </div>
      </MusicProvider>
    </InvitationProvider>
  );
}
