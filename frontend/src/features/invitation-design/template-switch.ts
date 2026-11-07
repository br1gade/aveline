import { canRender } from './payload';
import type { DesignBlock, DesignTemplate } from './types';

/**
 * What choosing another template changes (docs/API.md §6): the look goes back to its defaults,
 * shown sections it cannot render are switched off (their words kept), layouts it does not offer
 * go back to the default, and the sections it renders that the invitation lacks are not added.
 * The page says all of it before the host confirms (design PD-58).
 */
export interface SwitchEffects {
  hidden: string[];
  layoutsReset: string[];
  missing: string[];
}

export function switchEffects(
  blocks: readonly DesignBlock[],
  target: DesignTemplate,
): SwitchEffects {
  const types = new Set(blocks.map((block) => block.type));
  return {
    hidden: blocks
      .filter((block) => block.enabled && !canRender(target, block.type))
      .map((block) => block.type),
    layoutsReset: blocks
      .filter((block) => block.variant !== null && canRender(target, block.type))
      .filter((block) => !(target.blockVariants[block.type] ?? []).includes(block.variant ?? ''))
      .map((block) => block.type),
    missing: target.supportedBlocks.filter((type) => !types.has(type)),
  };
}
