import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every documented text and control pair keeps its contrast in both themes (WCAG 2.2 AA:
 * 4.5:1 for text, 3:1 for control edges and the focus ring). A token change that breaks a pair
 * fails here before anyone sees it.
 */
interface ColourToken {
  name: string;
  value: string | Record<string, string>;
}

interface Tokens {
  color: { themes: Array<{ id: string }>; tokens: ColourToken[] };
}

const tokens = JSON.parse(readFileSync(join(import.meta.dirname, 'tokens.json'), 'utf8')) as Tokens;

const byName = new Map(tokens.color.tokens.map((token) => [token.name, token]));

function resolve(name: string, theme: string): string {
  const token = byName.get(name);
  if (!token) {
    throw new Error(`No colour token ${name}`);
  }
  const value = typeof token.value === 'string' ? token.value : token.value[theme];
  if (!value) {
    throw new Error(`${name} has no value in ${theme}`);
  }
  const alias = /^\{(.+)\}$/.exec(value);
  return alias?.[1] ? resolve(alias[1], theme) : value;
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const SURFACES = ['surface', 'surface-raised', 'surface-sunken'];
const TEXT = ['text', 'text-muted', 'heading', 'label'];
const themes = tokens.color.themes.map((theme) => theme.id);

describe('token contrast', () => {
  it.each(themes)('text roles reach 4.5:1 on every surface in %s', (theme) => {
    for (const text of TEXT) {
      for (const surface of SURFACES) {
        const ratio = contrast(resolve(text, theme), resolve(surface, theme));
        expect(ratio, `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(themes)('control edges and the focus ring reach 3:1 in %s', (theme) => {
    for (const role of ['control-edge', 'focus']) {
      for (const surface of SURFACES) {
        const ratio = contrast(resolve(role, theme), resolve(surface, theme));
        expect(ratio, `${role} on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it.each(themes)('text on an action fill reaches 4.5:1 in %s', (theme) => {
    for (const fill of ['action', 'action-hover', 'action-pressed']) {
      const ratio = contrast(resolve('action-text', theme), resolve(fill, theme));
      expect(ratio, `action-text on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('error and success read on the light surfaces where forms live', () => {
    for (const role of ['error', 'success']) {
      for (const surface of SURFACES) {
        expect(contrast(resolve(role, 'ivory'), resolve(surface, 'ivory'))).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
    expect(
      contrast(resolve('error-ink', 'ivory'), resolve('error-tint', 'ivory')),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(resolve('error-ink-hover', 'ivory'), resolve('error-tint', 'ivory')),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(resolve('success-ink', 'ivory'), resolve('success-tint', 'ivory')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps gold and taupe out of text on light grounds', () => {
    // They are ornament there (design R-1): the test documents why gold-ink exists.
    expect(contrast(resolve('brand-gold', 'ivory'), resolve('ivory', 'ivory'))).toBeLessThan(3);
    expect(
      contrast(resolve('gold-ink', 'ivory'), resolve('ivory', 'ivory')),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
