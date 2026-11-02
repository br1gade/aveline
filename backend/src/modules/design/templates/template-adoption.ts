import { BlockType, Prisma } from '@prisma/client';
import { canRender, variantProblem } from '../block-rules';
interface AdoptionBlock { type: BlockType; enabled: boolean; variant: string | null }
interface AdoptionSource<T extends AdoptionBlock> { templateVersionId: string; theme: Prisma.JsonValue; blocks: T[] }
interface AdoptionTarget { id: string; defaultTheme: Prisma.JsonValue; supportedBlocks: BlockType[]; blockVariants: Prisma.JsonValue }
export function planTemplateAdoption<T extends AdoptionBlock>(source: AdoptionSource<T>, target: AdoptionTarget) {
  const isSameVersion = source.templateVersionId === target.id;
  const disabledBlocks: BlockType[] = []; const resetVariants: BlockType[] = [];
  const blocks = source.blocks.map((block) => {
    const isSupported = canRender(target, block.type);
    const hasInvalidVariant = variantProblem(target, block.type, block.variant) !== null;
    if (!isSupported && block.enabled) disabledBlocks.push(block.type);
    if (hasInvalidVariant) resetVariants.push(block.type);
    return { ...block, enabled: block.enabled && isSupported, variant: hasInvalidVariant ? null : block.variant };
  });
  return { theme: isSameVersion ? source.theme : target.defaultTheme, blocks,
    changes: { themeReset: !isSameVersion, disabledBlocks, resetVariants, assetDefaults: [] } };
}
