import { Prisma } from '@prisma/client';
import { DomainHttpException } from '../../../common/domain-http.exception';
import { RendererCapability } from './capabilities/template-capabilities.service';
export function assertAuthoredTheme(theme: Record<string, unknown>, version: { provenance: string; rendererManifest: Prisma.JsonValue }) {
  if (version.provenance !== 'AUTHORED') return;
  const manifest = version.rendererManifest as unknown as RendererCapability;
  const errors = Object.keys(theme).filter((key) => !manifest.themeKeys.includes(key)).map((field) => `${field}: unsupported theme field`);
  const colors = theme.colors;
  if (Array.isArray(colors) && Object.values(manifest.paletteRoles).some((position) => position >= colors.length)) errors.push('colors: provide every manifested palette role');
  if (errors.length) throw new DomainHttpException('TEMPLATE_VALIDATION_FAILED', errors);
}
