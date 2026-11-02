import { LEGACY_CATALOGUE } from './capabilities/legacy-catalogue';
import { validateTheme } from '../theme';
import { BlockType, Prisma } from '@prisma/client';

export interface TemplateDefinition {
  name: string;
  allowedFonts: string[];
  palettes: { name: string; colors: string[] }[];
  supportedBlocks: BlockType[];
  blockVariants: Record<string, string[]>;
  defaultTheme: Record<string, unknown>;
  rendererKey: string;
}
export interface TemplateFieldError { field: string; message: string }
const FIELDS = ['name', 'allowedFonts', 'palettes', 'supportedBlocks', 'blockVariants', 'defaultTheme', 'rendererKey'];
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateTemplateDefinition(input: unknown): TemplateFieldError[] {
  if (!isRecord(input)) return [{ field: 'definition', message: 'must be an object' }];
  const errors: TemplateFieldError[] = Object.keys(input).filter((key) => !FIELDS.includes(key)).map((field) => ({ field, message: 'unknown field' }));
  if (Buffer.byteLength(JSON.stringify(input)) > 65536) errors.push({ field: 'definition', message: 'at most 64KiB' });
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) errors.push({ field: 'name', message: '1–120 characters' });
  if (input.rendererKey !== LEGACY_CATALOGUE.rendererKey) errors.push({ field: 'rendererKey', message: 'unsupported renderer' });
  if (!isAllowedList(input.allowedFonts, LEGACY_CATALOGUE.fonts, 8)) errors.push({ field: 'allowedFonts', message: '1–8 distinct bundled font IDs from the backend ceiling' });
  if (!isAllowedList(input.supportedBlocks, LEGACY_CATALOGUE.blocks, 14)) errors.push({ field: 'supportedBlocks', message: '1–14 distinct supported block types' });
  errors.push(...validateVariants(input.blockVariants, input.supportedBlocks));
  errors.push(...validatePalettes(input.palettes));
  errors.push(...validateDefaultTheme(input));
  return errors;
}

function isAllowedList(input: unknown, ceiling: readonly string[], maximum: number): input is string[] {
  return Array.isArray(input) && input.length > 0 && input.length <= maximum && new Set(input).size === input.length
    && input.every((entry: unknown) => typeof entry === 'string' && ceiling.includes(entry));
}
function validateVariants(input: unknown, blocks: unknown): TemplateFieldError[] {
  if (!isRecord(input)) return [{ field: 'blockVariants', message: 'must be an object' }];
  return Object.entries(input).flatMap(([field, values]) => {
    const isBlock = Array.isArray(blocks) && blocks.includes(field);
    const isValid = Array.isArray(values) && values.length <= 3 && new Set(values).size === values.length
      && values.every((value: unknown) => typeof value === 'string' && LEGACY_CATALOGUE.variants.includes(value));
    return isBlock && isValid ? [] : [{ field: `blockVariants.${field}`, message: 'declare only supported blocks and distinct backend-ceiling variants' }];
  });
}
function validatePalettes(input: unknown): TemplateFieldError[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 12) return [{ field: 'palettes', message: '1–12 palettes' }];
  const errors = input.flatMap((palette: unknown, index) => {
    if (!isRecord(palette)) return [{ field: `palettes.${index}`, message: 'must be an object' }];
    const hasName = typeof palette.name === 'string' && /^[a-z0-9-]{1,40}$/.test(palette.name);
    const hasColors = Array.isArray(palette.colors) && palette.colors.length > 0 && palette.colors.length <= 8
      && palette.colors.every((color: unknown) => typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color));
    return hasName && hasColors && Object.keys(palette).every((key) => ['name', 'colors'].includes(key)) ? [] : [{ field: `palettes.${index}`, message: 'bounded name and 1–8 six-digit hex colors required; unknown fields refused' }];
  });
  const names = input.map((entry: unknown) => isRecord(entry) ? entry.name : null);
  if (new Set(names).size !== names.length) errors.push({ field: 'palettes', message: 'palette names must be unique' });
  return errors;
}
function validateDefaultTheme(input: Record<string, unknown>): TemplateFieldError[] {
  if (!isRecord(input.defaultTheme)) return [{ field: 'defaultTheme', message: 'must be an object' }];
  const errors = Object.keys(input.defaultTheme).filter((key) => !LEGACY_CATALOGUE.themeKeys.includes(key)).map((key) => ({ field: `defaultTheme.${key}`, message: 'unknown theme key' }));
  if (!Array.isArray(input.allowedFonts) || validatePalettes(input.palettes).length) return errors;
  const result = validateTheme(input.defaultTheme, { allowedFonts: input.allowedFonts as string[], palettes: input.palettes as TemplateDefinition['palettes'] });
  return result.isValid ? errors : [...errors, ...result.errors.map((message) => ({ field: 'defaultTheme', message }))];
}
export function definitionJson(definition: TemplateDefinition): Prisma.InputJsonValue {
  return definition as unknown as Prisma.InputJsonValue;
}
