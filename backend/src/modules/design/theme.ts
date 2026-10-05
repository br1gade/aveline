/**
 * Theme validation against the template that has to render it.
 *
 * A template declares the fonts it ships and the palettes it was designed
 * with. Those declarations were previously exposed to clients and never
 * enforced, so any string could be written into `Invitation.theme` and would
 * reach the renderer — a font nobody has, or a palette with one colour,
 * produces an invitation that looks broken to the couple who paid for it and
 * cannot be fixed from the UI that wrote it.
 *
 * Pure, so the whole decision table is testable without a database.
 */
export interface Palette { name: string; colors: string[] }

export interface TemplateConstraints {
  allowedFonts: readonly string[];
  palettes: readonly Palette[];
}

export interface ThemeInput {
  headingFont?: string;
  bodyFont?: string;
  palette?: string;
  /** A palette the host tuned themselves, when the template allows one. */
  colors?: string[];
  [key: string]: unknown;
}

export type ThemeValidation =
  | { isValid: true; theme: ThemeInput }
  | { isValid: false; errors: string[] };

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_CUSTOM_COLORS = 8;

/**
 * Every problem is reported, not just the first.
 *
 * A designer changing four things at once should see all four rejections in
 * one response rather than discovering them one request at a time.
 */
export function validateTheme(
  theme: ThemeInput,
  constraints: TemplateConstraints,
): ThemeValidation {
  const errors = [
    ...fontErrors(theme, constraints.allowedFonts),
    ...paletteErrors(theme, constraints.palettes),
    ...colorErrors(theme.colors),
  ];

  return errors.length === 0 ? { isValid: true, theme } : { isValid: false, errors };
}

function fontErrors(theme: ThemeInput, allowedFonts: readonly string[]): string[] {
  const chosen: [string, string | undefined][] = [
    ['headingFont', theme.headingFont],
    ['bodyFont', theme.bodyFont],
  ];

  return chosen
    .filter(([, font]) => font !== undefined && !allowedFonts.includes(font))
    .map(
      ([field, font]) =>
        `${field}: "${font ?? ''}" is not one of this template's fonts (${allowedFonts.join(', ')})`,
    );
}

function paletteErrors(theme: ThemeInput, palettes: readonly Palette[]): string[] {
  if (theme.palette === undefined) return [];

  const names = palettes.map((palette) => palette.name);
  return names.includes(theme.palette)
    ? []
    : [`palette: "${theme.palette}" is not one of this template's palettes (${names.join(', ')})`];
}

/**
 * Colours are checked for shape, not taste. A value that is not a hex triplet
 * is a rendering failure; an ugly one is the host's business.
 */
function colorErrors(colors: string[] | undefined): string[] {
  if (colors === undefined) return [];

  if (colors.length === 0) return ['colors: give at least one colour, or omit the field'];
  if (colors.length > MAX_CUSTOM_COLORS) {
    return [`colors: at most ${MAX_CUSTOM_COLORS} colours`];
  }

  return colors
    .filter((color) => !HEX_COLOR.test(color))
    .map((color) => `colors: "${color}" is not a six-digit hex colour like #1a2b3c`);
}

/**
 * The theme after a partial update.
 *
 * Omitted means "leave as is", so a client changing one font never has to
 * restate the palette — and cannot accidentally clear it by not mentioning it.
 *
 * Keys holding `undefined` are dropped, not merged. A validated DTO carries
 * every declared field, so a spread of one would overwrite the palette with
 * `undefined` and silently clear it — which is exactly the bug this guards.
 */
export function mergeTheme(current: ThemeInput, incoming: ThemeInput): ThemeInput {
  const stated = Object.entries(incoming).filter(([, value]) => value !== undefined);
  return { ...current, ...Object.fromEntries(stated) };
}
