import { DomainHttpException } from '../../../../common/domain-http.exception';
import { Injectable } from '@nestjs/common';
import { TemplateDefinition } from '../template-validation';
import { hashTemplateContent } from '../template-content';

export interface RendererCapability {
  rendererKey: string;
  capabilityVersion: string;
  schemaVersion: 1;
  frontendRevision: string;
  digest: string;
  locales: string[];
  fonts: { id: string; bundledHash: string }[];
  blocks: Record<string, { canDefault: boolean; variants: string[] }>;
  themeKeys: string[];
  paletteRoles: Record<string, number>;
  mediaSlots: string[];
}

/** Reviewed configuration, never populated from API input or an ADMIN whitelist. */
export const APPROVED_RENDERER_CAPABILITIES: readonly RendererCapability[] = [];
@Injectable()
export class TemplateCapabilitiesService {
  approved(): readonly RendererCapability[] { return APPROVED_RENDERER_CAPABILITIES; }
  match(definition: TemplateDefinition): RendererCapability | null {
    return this.approved().find((manifest) => isAcceptedDefinition(manifest, definition)) ?? null;
  }
  require(definition: TemplateDefinition): RendererCapability {
    const capability = this.match(definition);
    if (!capability) throw new DomainHttpException('TEMPLATE_CAPABILITY_NOT_DEPLOYED', 'A reviewed deployed renderer capability and frontend acceptance are required');
    return capability;
  }
}
export function capabilityDigest(manifest: Omit<RendererCapability, 'digest'>): string { return hashTemplateContent(manifest); }
function isAcceptedDefinition(manifest: RendererCapability, definition: TemplateDefinition): boolean {
  const { digest, ...content } = manifest;
  const hasLanguages = ['en', 'ru', 'fr', 'hy'].every((locale) => manifest.locales.includes(locale));
  const hasFonts = definition.allowedFonts.every((font) => manifest.fonts.some((entry) => entry.id === font && /^[a-f0-9]{64}$/.test(entry.bundledHash)));
  const hasBlocks = definition.supportedBlocks.every((block) => manifest.blocks[block]?.canDefault && (definition.blockVariants[block] ?? []).every((variant) => manifest.blocks[block].variants.includes(variant)));
  const hasTheme = Object.keys(definition.defaultTheme).every((key) => manifest.themeKeys.includes(key));
  const rolePositions = Object.values(manifest.paletteRoles);
  const hasRoles = rolePositions.length > 0 && rolePositions.every((position) => Number.isInteger(position) && position >= 0 && definition.palettes.every((palette) => position < palette.colors.length));
  return digest === capabilityDigest(content) && manifest.rendererKey === definition.rendererKey && manifest.schemaVersion === 1
    && manifest.frontendRevision.length > 0 && hasLanguages && hasFonts && hasBlocks && hasTheme && hasRoles;
}
