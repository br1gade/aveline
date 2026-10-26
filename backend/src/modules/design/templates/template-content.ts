import { createHash } from 'node:crypto';

export interface TemplateRenderDefinition {
  name: string;
  allowedFonts: string[];
  palettes: unknown;
  supportedBlocks: string[];
  blockVariants: unknown;
  defaultTheme: unknown;
}

/** Identity remains stable while every rendering input comes from the immutable pin. */
export function pinnedTemplate<T, V extends TemplateRenderDefinition>(invitation: { template: T; templateVersion: V }): T & Pick<V, keyof TemplateRenderDefinition> {
  const { name, allowedFonts, palettes, supportedBlocks, blockVariants, defaultTheme } = invitation.templateVersion;
  return { ...invitation.template, name, allowedFonts, palettes, supportedBlocks, blockVariants, defaultTheme };
}

export function canonicalTemplateContent(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalTemplateContent).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalTemplateContent(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashTemplateContent(value: unknown): string {
  return createHash('sha256').update(canonicalTemplateContent(value)).digest('hex');
}
