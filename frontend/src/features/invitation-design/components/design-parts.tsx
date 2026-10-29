import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { Problem } from '@/api/problems';
import { eventPath } from '@/features/events';
import { BLOCK_TYPES, type BlockType } from '@/features/invitation-renderer';
import { isLanguage } from '@/lib/i18n';
import { ProblemAlert } from '@/ui/app-form';

import { designPath, designQuestionsPath } from '../paths';
import { useRefusedText, type DesignAction } from '../refusals';

const LINK = 'text-primary self-start underline underline-offset-4 hover:no-underline';

interface DesignHeaderProps {
  eventId: string;
  /** Where "back" goes: the event's overview, the design's, or the questions'. */
  back: 'event' | 'design' | 'questions';
  title: string;
  subtitle: string;
  children?: ReactNode;
}

/** Every design page starts the same way: the way back, the page's title, and the event's. */
const BACK = { event: eventPath, design: designPath, questions: designQuestionsPath } as const;

export function DesignHeader({ eventId, back, title, subtitle, children }: DesignHeaderProps) {
  const { t } = useTranslation('design');
  return (
    <>
      <Link to={BACK[back](eventId)} className={LINK}>
        {t(`back.${back}`)}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal break-words">
          {title}
        </h1>
        <p className="text-muted-foreground m-0">{subtitle}</p>
      </div>
      {children}
    </>
  );
}

/** An event created when no template existed has no invitation (docs/API.md §6). */
export function NoInvitation({ eventId, title }: { eventId: string; title: string }) {
  const { t } = useTranslation('design');
  return (
    <section className="flex flex-col gap-5">
      <DesignHeader eventId={eventId} back="event" title={t('overview.title')} subtitle={title} />
      <p className="m-0 max-w-[40rem]">{t('noInvitation')}</p>
    </section>
  );
}

export function isKnownBlock(type: string): type is BlockType {
  return (BLOCK_TYPES as readonly string[]).includes(type);
}

/** A section's name in the page's language; a type this release does not know, as it came. */
export function useSectionName(): (type: string) => string {
  const { t } = useTranslation('design');
  return (type) => (isKnownBlock(type) ? t(`blocks.${type}.name`) : type);
}

/** A language in its own name, marked as that language; a code the app has no name for, as is. */
export function LanguageName({ code }: { code: string }) {
  const { t } = useTranslation('common');
  return <span lang={code}>{isLanguage(code) ? t(`language.${code}`) : code}</span>;
}

export interface DesignRefusalState {
  action: DesignAction;
  problem: Problem;
}

/** Why an action was refused, in this page's words, with the request id for a server failure. */
export function DesignRefusal({ refusal }: { refusal: DesignRefusalState }) {
  const refused = useRefusedText(refusal.action);
  return <ProblemAlert problem={refusal.problem} refused={refused} />;
}

export const TEXT_LINK = LINK;
