import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { LoadedProblem } from '@/features/sending';
import { StatusLine, usePageStatus, type PageActions } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import type { DesignLookData } from '../load';
import { designPreviewPath } from '../paths';
import { canRender } from '../payload';
import type { Design, DesignTemplate } from '../types';
import { DesignHeader, NoInvitation, useSectionName } from './design-parts';
import { SwitchTemplateDialog } from './switch-template-dialog';
import { PaletteSwatches, ThemeForm } from './theme-form';

const SECTION_TITLE = 'm-0 text-lg font-medium';

interface CardProps {
  design: Design;
  template: DesignTemplate;
  onUse: (template: DesignTemplate) => void;
}

/** Another template: what it offers, what of this invitation it cannot show, and its previews. */
function TemplateCard({ design, template, onUse }: CardProps) {
  const { t } = useTranslation('design');
  const nameOf = useSectionName();
  const cannotShow = design.blocks
    .filter((block) => block.enabled && !canRender(template, block.type))
    .map((block) => nameOf(block.type));
  const eventId = design.event.id;
  return (
    <li className="bg-card border-border flex flex-col gap-2 border px-5 py-4">
      <h3 className="m-0 text-base font-medium break-words">{template.name}</h3>
      <p className="m-0 text-sm">{t('look.fonts', { fonts: template.allowedFonts.join(', ') })}</p>
      <div className="flex flex-col gap-1 text-sm">
        {template.palettes.map((palette) => (
          <span key={palette.name} className="flex flex-wrap items-center gap-2">
            {palette.name} <PaletteSwatches palette={palette} />
          </span>
        ))}
      </div>
      <p className="text-muted-foreground m-0 text-sm">
        {cannotShow.length > 0
          ? t('look.cannotShow', { sections: cannotShow.join(', ') })
          : t('look.showsAll')}
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button asChild variant="outline">
          <Link to={designPreviewPath(eventId, { templateKey: template.key })}>
            {t('look.previewMine')}
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link to={designPreviewPath(eventId, { templateKey: template.key, isSample: true })}>
            {t('look.previewSample')}
          </Link>
        </Button>
        <Button
          aria-label={t('actionFor', { action: t('look.use'), name: template.name })}
          onClick={() => onUse(template)}
        >
          {t('look.use')}
        </Button>
      </div>
    </li>
  );
}

function OtherTemplates({
  data,
  design,
  page,
}: {
  data: DesignLookData;
  design: Design;
  page: PageActions;
}) {
  const { t } = useTranslation('design');
  const [target, setTarget] = useState<DesignTemplate | null>(null);
  if (data.templates.kind !== 'ready') {
    return <LoadedProblem loaded={data.templates} refusedText={t('look.templatesRefused')} />;
  }
  const others = data.templates.value.filter((template) => template.key !== design.template.key);
  if (others.length === 0) return <p className="text-muted-foreground m-0">{t('look.noOthers')}</p>;
  return (
    <>
      <ul className="m-0 flex max-w-[40rem] list-none flex-col gap-3 p-0">
        {others.map((template) => (
          <TemplateCard key={template.key} design={design} template={template} onUse={setTarget} />
        ))}
      </ul>
      {target ? (
        <SwitchTemplateDialog
          design={design}
          target={target}
          page={page}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </>
  );
}

function Look({ data, design }: { data: DesignLookData; design: Design }) {
  const { t } = useTranslation('design');
  const { page, status, statusRef } = usePageStatus(data);
  return (
    <section className="flex flex-col gap-6">
      <DesignHeader
        eventId={design.event.id}
        back="design"
        title={t('look.title')}
        subtitle={data.event.title}
      >
        <p className="m-0 max-w-[40rem]">{t('look.lead')}</p>
      </DesignHeader>
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      <section aria-labelledby="look-current" className="flex flex-col gap-3">
        <h2 id="look-current" className={SECTION_TITLE}>
          {t('look.current', { name: design.template.name })}
        </h2>
        <p className="text-muted-foreground m-0 max-w-[40rem] text-sm">{t('look.standIn')}</p>
        {/* A new template brings its own fonts and palettes: the form starts again from them. */}
        <ThemeForm key={design.template.key} design={design} page={page} />
        <Link
          to={designPreviewPath(design.event.id)}
          className="text-primary self-start underline underline-offset-4 hover:no-underline"
        >
          {t('look.preview')}
        </Link>
      </section>
      <section aria-labelledby="look-others" className="flex flex-col gap-3">
        <h2 id="look-others" className={SECTION_TITLE}>
          {t('look.othersTitle')}
        </h2>
        <OtherTemplates data={data} design={design} page={page} />
      </section>
    </section>
  );
}

/**
 * The template and its look (design PD-58). Fonts and palettes come only from the template's own
 * lists; choosing another template asks first, saying what it resets.
 */
export function DesignLook({ data }: { data: DesignLookData }) {
  if (!data.design) return <NoInvitation eventId={data.event.id} title={data.event.title} />;
  return <Look data={data} design={data.design} />;
}
