import type {
  BlockEditing,
  BlockMedia,
  Invitation,
  InvitationBlock,
} from '@/features/invitation-renderer';

import type { SectionFormValues } from './form-model';
import { languageCopy, settingsEdit } from './payload';
import type { DesignBlock, LibraryItem } from './types';

/** One section's form as it stands, and what the page knows around it. */
export interface DraftSection {
  /** The section as saved: its stored words, settings and media. */
  block: DesignBlock;
  editing: BlockEditing;
  values: SectionFormValues;
  /** The template's layouts for the section; `null` when the catalogue couldn't be read. */
  layouts: readonly string[] | null;
  library: readonly LibraryItem[];
  /** Every section's type, in the editor's order. */
  order: readonly string[];
  defaultLocale: string;
}

/** As `resolveTranslation` in the backend: the language, then the event's own, then any. */
function translated<T>(map: Readonly<Record<string, T>>, locale: string, defaultLocale: string) {
  return map[locale] ?? map[defaultLocale] ?? Object.values(map)[0] ?? null;
}

function draftContent({ block, editing, values, defaultLocale }: DraftSection, locale: string) {
  const copy = Object.fromEntries(
    Object.entries(values.copy).flatMap(([language, typed]) => {
      const content = languageCopy(block.content[language], typed, editing);
      return content ? [[language, content]] : [];
    }),
  );
  return translated(copy, locale, defaultLocale) ?? {};
}

/** A layout the template doesn't offer is drawn as its own, as the backend's preview does. */
function draftVariant({ values, layouts }: DraftSection): string | null {
  const variant = values.variant || null;
  return variant && layouts && !layouts.includes(variant) ? null : variant;
}

function draftMedia(draft: DraftSection, saved: InvitationBlock | undefined, locale: string) {
  const { values, block, library, defaultLocale } = draft;
  // With none chosen the backend shows the template's own, which only the saved page holds.
  if (values.assetIds.length === 0 && block.assetIds.length === 0) return saved?.media ?? [];
  const byId = new Map(library.map((item) => [item.id, item]));
  return values.assetIds.flatMap((id): BlockMedia[] => {
    const item = byId.get(id);
    if (!item) return [];
    const { url, privateAsset, kind, width, height, variants } = item;
    const altText = translated(item.altText, locale, defaultLocale);
    return [{ id, url, privateAsset, kind, altText, width, height, variants }];
  });
}

/** Where a section not on the saved page goes: after the last one the editor puts before it. */
function insertAt(blocks: readonly InvitationBlock[], order: readonly string[], type: string) {
  const position = order.indexOf(type);
  if (position === -1) return blocks.length;
  const before = blocks.map(({ type: other }) => order.indexOf(other));
  const last = before.findLastIndex((index) => index !== -1 && index < position);
  return last + 1;
}

/** The section as it would be drawn once saved; its facts (`data`) are the saved page's. */
function drawnBlock(
  draft: DraftSection,
  before: InvitationBlock | undefined,
  locale: string,
): InvitationBlock {
  const { block, editing, values } = draft;
  return {
    type: block.type,
    sortOrder: before?.sortOrder ?? 0,
    variant: draftVariant(draft),
    settings: editing.hasSwatches ? settingsEdit(block, values.colours) : block.settings,
    content: draftContent(draft, locale),
    media: draftMedia(draft, before, locale),
    data: before?.data ?? null,
  };
}

/**
 * The saved page with one section as its form stands (design PD-153): its words in the page's
 * language, its layout, colours and media, as the backend would build them once saved. **A
 * temporary stand-in** under FR-120, which restates the backend's fallbacks; the other sections,
 * and the page's order, are the saved page's own, never sorted.
 */
export function draftInvitation(saved: Invitation, draft: DraftSection): Invitation {
  const { type } = draft.block;
  const index = saved.blocks.findIndex((block) => block.type === type);
  const drawn = drawnBlock(draft, saved.blocks[index], saved.locale);
  const blocks = [...saved.blocks];
  if (index === -1) blocks.splice(insertAt(blocks, draft.order, type), 0, drawn);
  else blocks[index] = drawn;
  const firstUrl = drawn.media[0]?.url ?? null;
  return {
    ...saved,
    blocks,
    ...(type === 'HERO' ? { coverUrl: firstUrl } : {}),
    ...(type === 'MUSIC' ? { musicUrl: firstUrl } : {}),
  };
}
