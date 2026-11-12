import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

import { redactUrl } from '../../../src/lib/capability-links/redact';

/**
 * What every page owes its reader, checked the same way on every page (ARCHITECTURE §10; design
 * DESIGN_SYSTEM "Accessibility"): WCAG 2.2 AA by axe, 44 px targets on touch, no sideways scroll,
 * the language it is in, and no raw translation key.
 */

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** The page's path for a failure's message, any capability token in it redacted. */
function where(page: Page): string {
  return new URL(redactUrl(page.url())).pathname;
}

/** Serious and critical violations fail, each named with where it is. */
/**
 * Axe's findings once the page is still. A page that replaces its own address after loading, or the
 * dev server reloading it, destroys the context axe runs in: it is run again on the settled page,
 * once, and anything else fails as it came.
 */
async function axeOn(page: Page) {
  // A dialog fading in shows half its colours, which axe reads as poor contrast.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  );
  try {
    return await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  } catch (error) {
    if (!String(error).includes('Execution context was destroyed')) throw error;
    await page.waitForLoadState('networkidle');
    return new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  }
}

export async function expectAccessible(page: Page): Promise<void> {
  const { violations } = await axeOn(page);
  const failing = violations
    .filter(({ impact }) => impact === 'serious' || impact === 'critical')
    .map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(' ')).join(', ')}`);
  expect(failing, `axe on ${where(page)}`).toEqual([]);
}

/**
 * Every control at least 44 px each way (design DESIGN_SYSTEM: touch targets). A Radix radio or
 * checkbox is pressed through its button, its native input hidden from both pointer and reader.
 */
export async function expectTargets44(page: Page): Promise<void> {
  const small = await page.evaluate(() => {
    /** Not pressable, or not to be seen until focused, as a skip link is. */
    const isHidden = (control: Element) => {
      const style = getComputedStyle(control);
      const isVisuallyHidden =
        style.clipPath === 'inset(50%)' || style.clip === 'rect(0px, 0px, 0px, 0px)';
      return (
        isVisuallyHidden ||
        style.pointerEvents === 'none' ||
        style.visibility === 'hidden' ||
        control.closest('[hidden], [aria-hidden="true"]') !== null
      );
    };
    /** A press area drawn by `::before` around a small control, as the kit's radios and checkboxes have. */
    const pressArea = (control: Element, box: DOMRect) => {
      const before = getComputedStyle(control, '::before');
      if (before.content === 'none' || before.position !== 'absolute')
        return { width: 0, height: 0 };
      const offset = (value: string) => Number.parseFloat(value) || 0;
      return {
        width: box.width - offset(before.left) - offset(before.right),
        height: box.height - offset(before.top) - offset(before.bottom),
      };
    };
    /** What a finger can press: the control's label, the control, or the area drawn around it. */
    const target = (control: Element) => {
      const own = (control.closest('label') ?? control).getBoundingClientRect();
      const drawn = pressArea(control, own);
      return {
        own,
        width: Math.max(own.width, drawn.width),
        height: Math.max(own.height, drawn.height),
      };
    };
    const describe = (control: Element, width: number, height: number) => {
      const label = (control.getAttribute('aria-label') ?? control.textContent ?? '').trim();
      return `${control.tagName.toLowerCase()} "${label.slice(0, 40)}" ${Math.round(width)}×${Math.round(height)}`;
    };
    const controls = document.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type="hidden"]), select, textarea, [role="checkbox"], [role="radio"], summary',
    );
    return [...controls].flatMap((control) => {
      if (isHidden(control)) return [];
      const { own, width, height } = target(control);
      const isShown = own.width > 0 && own.height > 0;
      return isShown && (width < 44 || height < 44) ? [describe(control, width, height)] : [];
    });
  });
  expect(small, `targets under 44 px on ${where(page)}`).toEqual([]);
}

/** Nothing reaches past the screen's right edge. */
export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `sideways scroll on ${where(page)}`).toBeLessThanOrEqual(0);
}

export async function expectHtmlLang(page: Page, language: string): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('lang', language);
}

/** Every key the English strings have, as `namespace.path`, the shape a missing string shows as. */
function translationKeys(): ReadonlySet<string> {
  const folder = join(import.meta.dirname, '../../../src/locales/en');
  const keys = new Set<string>();
  const walk = (prefix: string, value: unknown) => {
    if (typeof value !== 'object' || value === null) {
      keys.add(prefix);
      return;
    }
    for (const [key, inner] of Object.entries(value)) walk(`${prefix}.${key}`, inner);
  };
  for (const file of readdirSync(folder)) {
    const namespace = file.replace(/\.json$/u, '');
    const strings: unknown = JSON.parse(readFileSync(join(folder, file), 'utf8'));
    walk(namespace, strings);
    // Without its namespace, as `t` shows a key it can't find in the one it was given.
    for (const [key, inner] of Object.entries(strings as Record<string, unknown>)) walk(key, inner);
  }
  return keys;
}

const KEYS = translationKeys();

/** No text on the page is a translation key, which is how a missing string shows. */
export async function expectNoRawKeys(page: Page): Promise<void> {
  const words = await page.evaluate(() =>
    (document.body.innerText.match(/[a-z][A-Za-z-]*(?:\.[A-Za-z][A-Za-z0-9-]*)+/gu) ?? []).slice(
      0,
      2000,
    ),
  );
  expect(
    words.filter((word) => KEYS.has(word)),
    `raw keys on ${where(page)}`,
  ).toEqual([]);
}

/** All of the above, at the width the project gives; targets only where a finger presses them. */
export async function expectSoundPage(page: Page, language: string): Promise<void> {
  await expectHtmlLang(page, language);
  await expectNoRawKeys(page);
  await expectNoSidewaysScroll(page);
  if ((page.viewportSize()?.width ?? 0) < 768) await expectTargets44(page);
  await expectAccessible(page);
}

/**
 * A capability token reached nothing but what is allowed to carry it: not storage, not the
 * console, not another request's address (frontend/CLAUDE.md §4).
 */
export async function expectTokenKept(
  page: Page,
  token: string,
  seen: { console: string[]; requests: string[] },
  allowed: (address: string) => boolean,
): Promise<void> {
  const stored = await page.evaluate(() =>
    JSON.stringify({ local: { ...window.localStorage }, session: { ...window.sessionStorage } }),
  );
  expect(stored.includes(token), 'token in storage').toBe(false);
  expect(
    seen.console.some((line) => line.includes(token)),
    'token in the console',
  ).toBe(false);
  expect(
    seen.requests.filter((address) => address.includes(token) && !allowed(address)).length,
    'token in a request it has no business in',
  ).toBe(0);
}
