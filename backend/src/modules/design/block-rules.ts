import { BadRequestException } from '@nestjs/common';
import { BlockType, Prisma } from '@prisma/client';

/**
 * What a template can render: which blocks, and in which layouts.
 *
 * Pure, and one place, because three calls decide it — the block edit, the
 * arrangement and the template switch — and before this the block edit
 * checked neither: it could switch on a block the template cannot render, and
 * `variant` took any text (B46).
 */
export interface TemplateRules {
  supportedBlocks: BlockType[];
  blockVariants: Prisma.JsonValue;
}

/** The layouts a template offers for one block type; none if it names none. */
export function variantsFor(template: TemplateRules, type: BlockType): string[] {
  const offered = isRecord(template.blockVariants) ? template.blockVariants[type] : undefined;
  return Array.isArray(offered) ? offered.filter((variant): variant is string => typeof variant === 'string') : [];
}

/** An empty list means the template declares no restriction. */
export function canRender(template: TemplateRules, type: BlockType): boolean {
  return template.supportedBlocks.length === 0 || template.supportedBlocks.includes(type);
}

/** Why this variant is refused for this block, or null if it is fine. `null` always is: the default layout. */
export function variantProblem(template: TemplateRules, type: BlockType, variant: string | null | undefined): string | null {
  if (variant === undefined || variant === null) return null;
  const offered = variantsFor(template, type);
  if (offered.includes(variant)) return null;
  return offered.length === 0
    ? `${type} takes no layout in this template; "${variant}" is not one`
    : `${type} has no layout "${variant}" in this template; it offers ${offered.join(', ')}`;
}

/** Throws for a block the template cannot render being switched on, or a layout it does not offer. */
export function assertBlockEdit(template: TemplateRules, type: BlockType, edit: { enabled?: boolean; variant?: string | null }): void {
  if (edit.enabled === true && !canRender(template, type)) {
    throw new BadRequestException(`enabled: this template cannot render ${type}; switch template or leave it off`);
  }
  const problem = variantProblem(template, type, edit.variant);
  if (problem) throw new BadRequestException(`variant: ${problem}`);
}

function isRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
