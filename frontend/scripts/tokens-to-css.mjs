#!/usr/bin/env node
/**
 * Generates the design tokens' CSS from src/styles/tokens.json, a copy of the Aveline Events design
 * system's tokens (docs/design/DESIGN_SYSTEM.md §13):
 *
 * - src/styles/tokens.css: plain CSS custom properties, the Ivory theme on :root and the Bordeaux
 *   theme under [data-theme="bordeaux"]. Usable anywhere, including the design canvas.
 * - src/styles/theme.css: the Tailwind 4 mapping (`@theme inline`) and one utility per type style.
 *
 * `--check` regenerates in memory and fails if either file differs: the CSS never drifts from the
 * JSON, and nobody edits it by hand.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src/styles/tokens.json');
const targets = {
  tokens: join(root, 'src/styles/tokens.css'),
  theme: join(root, 'src/styles/theme.css'),
};

const HEADER =
  '/* Aveline Events — generated from tokens.json by scripts/tokens-to-css.mjs. Do not edit. */';

/**
 * The self-hosted variable fonts come first, in the design system's order (the Armenian family,
 * then base Noto); the design system's stack follows unchanged.
 */
const VARIABLE_FONTS = {
  serif: ['"Noto Serif Armenian Variable"', '"Noto Serif Variable"'],
  sans: ['"Noto Sans Armenian Variable"', '"Noto Sans Variable"'],
};

/** `{ivory}` becomes `var(--ivory)`; anything else is a literal value. */
function cssValue(value) {
  const alias = /^\{([A-Za-z0-9_.-]+)\}$/.exec(value);
  return alias ? `var(--${alias[1]})` : value;
}

function declarations(entries) {
  return entries.map(([name, value]) => `  --${name}: ${value};`).join('\n');
}

function colourEntries(tokens, themeId, isPrimary) {
  return tokens.flatMap((token) => {
    if (typeof token.value === 'string') {
      return isPrimary ? [[token.name, cssValue(token.value)]] : [];
    }
    const value = token.value[themeId];
    return value === undefined ? [] : [[token.name, cssValue(value)]];
  });
}

function familyEntries(families) {
  return Object.entries(families).map(([role, stack]) => [
    `family-${role}`,
    [...(VARIABLE_FONTS[role] ?? []), stack].join(', '),
  ]);
}

function scaleEntries(tokens) {
  const groups = [tokens.spacing, tokens.radius, tokens.shadow, tokens.layout, tokens.size];
  return groups.flatMap((group) => (group?.tokens ?? []).map((token) => [token.name, token.value]));
}

function tokensCss(tokens) {
  const [primary, ...others] = tokens.color.themes;
  const primaryBlock = [
    `:root,\n[data-theme='${primary.id}'] {`,
    declarations([
      ...colourEntries(tokens.color.tokens, primary.id, true),
      ...familyEntries(tokens.type.families),
      ...scaleEntries(tokens),
    ]),
    '}',
  ].join('\n');
  const otherBlocks = others.map((theme) =>
    [
      `[data-theme='${theme.id}'] {`,
      declarations(colourEntries(tokens.color.tokens, theme.id, false)),
      '}',
    ].join('\n'),
  );
  return [HEADER, primaryBlock, ...otherBlocks].join('\n\n') + '\n';
}

/** Type grows fluidly between these viewport widths (DESIGN_SYSTEM §3.2). */
const FLUID_FROM = 360;
const FLUID_TO = 1440;

/**
 * The desktop size of a type style. tokens.json holds it only in the style's usage note, as
 * "40/46px on desktop" or "80/84px from 1024px wide", so it is read strictly: a note that mentions
 * desktop in any other words fails the build instead of silently losing the size.
 */
function desktopSize(style) {
  const match = /(\d+)\/(\d+)px (?:on desktop|from 1024px wide)/.exec(style.usage ?? '');
  if (match) return { fontSize: Number(match[1]), lineHeight: Number(match[2]) };
  if (/desktop|1024px/.test(style.usage ?? '')) {
    throw new Error(`Cannot read the desktop size of type style ${style.name}: "${style.usage}"`);
  }
  return null;
}

function pixels(value) {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value);
  if (!match) throw new Error(`Expected a size in px, got "${value}"`);
  return Number(match[1]);
}

function rem(px) {
  return `${Number((px / 16).toFixed(4))}rem`;
}

/**
 * A size that is `phone` at 360 px wide and `desktop` at 1440 px, in rem so text zoom still applies.
 * Every desktop size is under 2.5 times its phone size, which keeps 200 % zoom reachable (WCAG
 * 1.4.4).
 */
function fluid(phone, desktop) {
  if (phone === desktop) return `${phone}px`;
  const slope = (desktop - phone) / (FLUID_TO - FLUID_FROM);
  const intercept = phone - slope * FLUID_FROM;
  const preferred = `${rem(intercept)} + ${Number((slope * 100).toFixed(4))}vw`;
  return `clamp(${rem(phone)}, ${preferred}, ${rem(desktop)})`;
}

function typeUtility(style, family) {
  const desktop = desktopSize(style);
  const fontSize = desktop ? fluid(pixels(style.fontSize), desktop.fontSize) : style.fontSize;
  const lineHeight = desktop
    ? fluid(pixels(style.lineHeight), desktop.lineHeight)
    : style.lineHeight;
  const lines = [
    `  font-family: var(--family-${family});`,
    `  font-size: ${fontSize};`,
    `  line-height: ${lineHeight};`,
    `  font-weight: ${style.fontWeight};`,
  ];
  if (style.letterSpacing) {
    lines.push(`  letter-spacing: ${style.letterSpacing};`);
  }
  return `@utility type-${style.name} {\n${lines.join('\n')}\n}`;
}

function themeCss(tokens) {
  const colours = tokens.color.tokens.map((token) => [
    `color-${token.name}`,
    `var(--${token.name})`,
  ]);
  const fonts = Object.keys(tokens.type.families).map((role) => [
    `font-${role}`,
    `var(--family-${role})`,
  ]);
  const themeBlock = ['@theme inline {', declarations([...colours, ...fonts]), '}'].join('\n');
  const utilities = tokens.type.groups.flatMap((group) =>
    group.styles.map((style) => typeUtility(style, group.family)),
  );
  return [HEADER, themeBlock, ...utilities].join('\n\n') + '\n';
}

function generate() {
  const tokens = JSON.parse(readFileSync(source, 'utf8'));
  return { tokens: tokensCss(tokens), theme: themeCss(tokens) };
}

function readOrEmpty(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

const output = generate();
if (process.argv.includes('--check')) {
  const stale = Object.keys(targets).filter((key) => readOrEmpty(targets[key]) !== output[key]);
  if (stale.length > 0) {
    console.error(
      `Out of date with tokens.json: ${stale.map((key) => targets[key]).join(', ')}. Run npm run tokens.`,
    );
    process.exit(1);
  }
  console.log('Token CSS matches tokens.json.');
} else {
  for (const key of Object.keys(targets)) {
    writeFileSync(targets[key], output[key]);
  }
  console.log('Wrote src/styles/tokens.css and src/styles/theme.css.');
}
