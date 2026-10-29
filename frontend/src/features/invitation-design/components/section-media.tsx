import { useWatch, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { Loaded } from '@/api/loaded';
import type { BlockMediaUse } from '@/features/invitation-renderer';
import { LoadedProblem } from '@/features/sending';
import { Button } from '@/ui/kit/button';

import type { SectionFormValues } from '../form-model';
import { canShowMedia } from '../media-rules';
import { designMediaPath } from '../paths';
import type { DesignMedia, LibraryItem } from '../types';
import { TEXT_LINK, useSectionName } from './design-parts';
import { MediaThumbnail } from './media-thumbnail';

interface SectionMediaProps {
  form: UseFormReturn<SectionFormValues>;
  use: Exclude<BlockMediaUse, 'none'>;
  library: Loaded<LibraryItem[]>;
  /** What the section shows now, for uploads the library no longer lists. */
  shown: readonly DesignMedia[];
  eventId: string;
  /** For descriptions: the page's language first, then the event's default. */
  languages: readonly string[];
  type: string;
}

function move(ids: readonly string[], from: number, to: number): string[] {
  const moved = [...ids];
  const [id] = moved.splice(from, 1);
  if (id !== undefined) moved.splice(to, 0, id);
  return moved;
}

interface AttachedProps extends SectionMediaProps {
  ids: readonly string[];
  byId: ReadonlyMap<string, DesignMedia>;
  set: (ids: string[]) => void;
}

/** What the section shows, in order; only a gallery shows more than the first. */
function Attached({ ids, byId, set, use, languages }: AttachedProps) {
  const { t } = useTranslation('design');
  if (ids.length === 0)
    return <p className="text-muted-foreground m-0 text-sm">{t('section.noMedia')}</p>;
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {ids.map((id, position) => {
        const media = byId.get(id);
        return (
          <li key={id} className="flex flex-wrap items-center gap-2">
            {media ? (
              <MediaThumbnail media={media} languages={languages} />
            ) : (
              <span>{t('media.gone')}</span>
            )}
            <div className="flex flex-wrap gap-1">
              {use === 'images' && position > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => set(move(ids, position, position - 1))}
                >
                  {t('section.mediaUp', { number: position + 1 })}
                </Button>
              ) : null}
              {use === 'images' && position < ids.length - 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => set(move(ids, position, position + 1))}
                >
                  {t('section.mediaDown', { number: position + 1 })}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                onClick={() => set(ids.filter((other) => other !== id))}
              >
                {t('section.mediaRemove', { number: position + 1 })}
              </Button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Uploads this section can show and does not yet; one picture or one audio replaces the current. */
function Candidates({ ids, set, use, library, languages }: AttachedProps) {
  const { t } = useTranslation('design');
  if (library.kind !== 'ready') {
    return <LoadedProblem loaded={library} refusedText={t('media.refused')} />;
  }
  const candidates = library.value.filter(
    (item) => canShowMedia(use, item.kind) && !ids.includes(item.id),
  );
  if (candidates.length === 0)
    return <p className="text-muted-foreground m-0 text-sm">{t('section.noCandidates')}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {candidates.map((item, position) => (
        <li key={item.id} className="flex flex-wrap items-center gap-2">
          <MediaThumbnail media={item} languages={languages} />
          <Button
            type="button"
            variant="outline"
            onClick={() => set(use === 'images' ? [...ids, item.id] : [item.id])}
          >
            {t(use === 'images' ? 'section.mediaAdd' : 'section.mediaUse', {
              number: position + 1,
            })}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The section's media, chosen from the event's uploads (design PD-57): the cover's photo, the
 * story's, the gallery's in order, the signature's image, or the music. Saved with the section.
 */
export function SectionMedia(props: SectionMediaProps) {
  const { t } = useTranslation('design');
  const { form, library, shown, eventId, type } = props;
  const ids = useWatch({ control: form.control, name: 'assetIds' });
  const set = (next: string[]) => form.setValue('assetIds', next, { shouldDirty: true });
  const known: DesignMedia[] = [...shown, ...(library.kind === 'ready' ? library.value : [])];
  const byId = new Map(known.map((media) => [media.id, media]));
  const shared = { ...props, ids, byId, set };
  const name = useSectionName()(type);
  return (
    <fieldset className="border-border m-0 flex min-w-0 flex-col gap-4 border px-5 pt-3 pb-5">
      <legend className="px-1 text-base font-medium">{t(`section.media.${props.use}`)}</legend>
      {props.use !== 'images' && ids.length > 1 ? (
        <p className="text-muted-foreground m-0 text-sm">{t('section.onlyFirst', { name })}</p>
      ) : null}
      <Attached {...shared} />
      <h3 className="m-0 text-sm font-medium">{t('section.candidates')}</h3>
      <Candidates {...shared} />
      <Link to={designMediaPath(eventId)} className={TEXT_LINK}>
        {t('section.upload')}
      </Link>
    </fieldset>
  );
}
