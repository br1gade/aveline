import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvitationBlock, MediaKind, Prisma } from '@prisma/client';
import { languageKeysProblem } from '../../common/field-translations';
import { assertBlockEdit, TemplateRules } from './block-rules';
import { mergeTranslations } from './translated-content';
import { DraftPreviewDto } from './dto/draft-preview.dto';
import { blockMediaProblem } from './block-media';

export function previewBlocks(blocks: InvitationBlock[], template: TemplateRules, edit?: DraftPreviewDto): InvitationBlock[] {
  if (!edit) return blocks;
  if (!blocks.some((block) => block.type === edit.type)) throw new NotFoundException('type: this invitation has no such block');
  assertBlockEdit(template, edit.type, edit);
  const problem = languageKeysProblem('content', edit.content);
  if (problem) throw new BadRequestException(problem);
  return blocks.map((block) => block.type === edit.type ? applyPreviewEdit(block, edit) : block);
}

export function assertPreviewAssets(edit: DraftPreviewDto | undefined, assets: { id: string; kind: MediaKind }[]): void {
  if (!edit?.assetIds) return;
  const requested = new Set(edit.assetIds);
  const chosen = assets.filter((asset) => requested.has(asset.id));
  if (chosen.length !== requested.size) throw new BadRequestException('assetIds: one or more assets do not belong to this event');
  const problem = blockMediaProblem(edit.type, chosen);
  if (problem) throw new BadRequestException(problem);
}

function applyPreviewEdit(block: InvitationBlock, edit: DraftPreviewDto): InvitationBlock {
  return { ...block,
    content: edit.content ? mergeTranslations(block.content, edit.content) as Prisma.JsonValue : block.content,
    settings: edit.settings === undefined ? block.settings : edit.settings as Prisma.JsonValue,
    variant: edit.variant === undefined ? block.variant : edit.variant,
    enabled: edit.enabled ?? block.enabled,
    assetIds: edit.assetIds ?? block.assetIds,
  };
}
