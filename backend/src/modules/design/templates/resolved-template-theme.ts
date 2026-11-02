import { Prisma } from '@prisma/client';
import { RendererCapability } from './capabilities/template-capabilities.service';
export interface AuthoredTemplateVersion {
  id: string; provenance: string; rendererKey: string; capabilityVersion: string | null; capabilityDigest: string | null;
  contentHash: string; rendererManifest: Prisma.JsonValue; palettes: Prisma.JsonValue;
}
/** The immutable release stores the role mapping; live reads never infer positional legacy roles. */
export function resolvedTemplateTheme(version: AuthoredTemplateVersion | undefined, theme: Record<string, unknown>) {
  if (!version || version.provenance !== 'AUTHORED') return {};
  const manifest = version.rendererManifest as unknown as RendererCapability;
  const palettes = version.palettes as unknown as { name: string; colors: string[] }[];
  const palette = palettes.find((entry) => entry.name === theme.palette);
  const colors = Array.isArray(theme.colors) ? theme.colors as string[] : palette?.colors ?? [];
  const roles = Object.fromEntries(Object.entries(manifest.paletteRoles).map(([role, position]) => [role, colors[position]]));
  return { templateVersion: { id: version.id, rendererKey: version.rendererKey, capabilityVersion: version.capabilityVersion,
    capabilityDigest: version.capabilityDigest, contentHash: version.contentHash },
    resolvedTheme: { headingFont: theme.headingFont ?? theme.bodyFont, bodyFont: theme.bodyFont ?? theme.headingFont,
      palette: { name: theme.palette ?? null, roles } } };
}
