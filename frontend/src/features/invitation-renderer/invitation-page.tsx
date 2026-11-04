import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Language } from '@/lib/i18n';
import { ButtonLink, cx, LanguageSwitcher, StatusChip } from '@/ui';

import { blockComponent } from './blocks/registry';
import { InvitationProvider, useInvitation } from './context';
import { Cover, CoverPhoto, isFullBleed } from './components/cover';
import { FooterMark } from './components/footer-mark';
import { FloatingPause, MusicControl, MusicProvider } from './components/music';
import { PersonalCard } from './components/personal-card';
import { ReplyBar, useVisibility } from './components/reply-bar';
import {
  REPLY_HEADING_ID,
  REPLY_SECTION_ID,
  replyFromInvitation,
  type ReplySummary,
} from './components/reply-summary';
import { COLUMN, GUTTERS, Section } from './components/section';
import { useStatusText } from './components/status-text';
import type { ArtworkLoader } from './private-artwork';
import { preloadFonts } from './fonts';
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
  /** On personal links, inside the personal card under the names: correcting one's name (PD-64). */
  renderPersonal?: (() => ReactNode) | undefined;
  /** On personal links, a section after the letter: the guests' photos (PD-63). */
  renderContributions?: (() => ReactNode) | undefined;
  /** How this page reads private artwork: the guest's link, or the host's session (PD-140). */
  artwork?: ArtworkLoader | undefined;
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

type Slots = Pick<InvitationPageProps, 'renderPersonal' | 'renderContributions'>;

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

/**
 * The photograph fills the first screen, with `burgundy-deep` at 65% behind every word on it, which
 * holds 4.5:1 over even a white area (design PD-34), and a gradient rising from that to nothing.
 */
function FullBleedHeader({ cover, action, languageHref }: HeaderProps) {
  return (
    <header
      data-theme="bordeaux"
      className="bg-surface text-text relative flex min-h-svh flex-col lg:sticky lg:top-0 lg:row-span-2 lg:h-svh lg:overflow-y-auto"
    >
      <CoverPhoto block={cover} />
      <div className="bg-burgundy-deep/65 relative px-5 pt-4 pb-2 lg:px-12">
        <TopBar languageHref={languageHref} />
      </div>
      <div className="flex-auto" />
      <div
        aria-hidden="true"
        className="from-burgundy-deep/65 relative h-24 bg-linear-to-t to-transparent"
      />
      <div className="bg-burgundy-deep/65 relative px-5 pb-18 lg:px-12 lg:pb-12">
        <Cover block={cover} action={action} isOverPhoto />
      </div>
    </header>
  );
}

type HeaderProps = Pick<LayoutProps, 'languageHref'> & {
  cover: InvitationBlock;
  action: ReactNode;
};

/** HERO first: the cover is the header, on top on phones and pinned left from 1024 px. */
function CoverHeader({ cover, reply, languageHref }: LayoutProps & { cover: InvitationBlock }) {
  const { invitation } = useInvitation();
  const action = canReply(invitation) ? (
    <div className="hidden lg:block">
      <CoverReply reply={reply} />
    </div>
  ) : null;
  if (isFullBleed(cover)) {
    return <FullBleedHeader cover={cover} action={action} languageHref={languageHref} />;
  }
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
function PersonalCardSlot({
  reply,
  hasCover,
  renderPersonal,
}: {
  reply: ReplySummary | null;
  hasCover: boolean;
  renderPersonal: Slots['renderPersonal'];
}) {
  const { invitation } = useInvitation();
  if (!invitation.guest) return null;
  return (
    <div className={cx(GUTTERS, 'relative', hasCover ? '-mt-8 lg:mt-16' : 'mt-8')}>
      <PersonalCard
        guest={invitation.guest}
        reply={reply}
        replyButtonId={CARD_REPLY_ID}
        extra={renderPersonal?.()}
        className={cx(COLUMN, hasCover && 'shadow-(--shadow-card) lg:shadow-none')}
      />
    </div>
  );
}

/** A preview's page sits under the host's bar, and can't be answered. */
function canSkipToReply(invitation: Invitation): boolean {
  return !invitation.isPreview && invitation.blocks.some((block) => block.type === 'RSVP');
}

/**
 * The page (spec §4, §8). With HERO first, the cover is the header, and from 1024 px the open
 * card: the cover pinned in the left 5/12, the letter scrolling on the right. Otherwise one
 * centred column with the cover in place.
 */
function Layout({
  invitation,
  reply,
  languageHref,
  renderPersonal,
  renderContributions,
}: LayoutProps & Slots) {
  const cover = invitation.blocks[0]?.type === 'HERO' ? invitation.blocks[0] : undefined;
  const isBarWanted = canReply(invitation);
  const isNothingInView =
    useVisibility(isBarWanted ? [REPLY_SECTION_ID, CARD_REPLY_ID] : []) === 'none';

  return (
    <>
      {canSkipToReply(invitation) ? <SkipToReply /> : null}
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
          <PersonalCardSlot
            reply={reply}
            hasCover={Boolean(cover)}
            renderPersonal={renderPersonal}
          />
          <Letter blocks={invitation.blocks} />
          {invitation.guest && renderContributions ? (
            <Section>{renderContributions()}</Section>
          ) : null}
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
  renderPersonal,
  renderContributions,
  artwork,
}: InvitationPageProps) {
  const zone = { timeZone: invitation.event.timezone, locale: invitation.locale };
  const palette = invitationPalette(invitation.theme);
  const summary = reply === undefined ? replyFromInvitation(invitation) : reply;
  preloadFonts(invitation.locale);
  return (
    <InvitationProvider value={{ invitation, zone, renderReply, replyHeading, artwork }}>
      <MusicProvider url={invitation.musicUrl}>
        <div data-palette={palette.name} data-theme={palette.letterTheme}>
          <Layout
            invitation={invitation}
            reply={summary}
            languageHref={languageHref}
            renderPersonal={renderPersonal}
            renderContributions={renderContributions}
          />
        </div>
      </MusicProvider>
    </InvitationProvider>
  );
}
