# Aveline design system

> **Status: proposed.** Written on 13 October 2026.
>
> **What is confirmed and what is not:**
>
> - Confirmed: the three brand colours and the four Noto families ([BRAND_BRIEF.md](BRAND_BRIEF.md)).
> - **Recommendations:** every other value here: neutrals, derived colours, scales, components.
>   They are listed as R- items in [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md).
> - Every contrast ratio below was computed, not estimated.
>
> **Where it lives** ([§13](#13-where-the-system-lives)):
>
> - **Token values now live in code** (18 October 2026): `frontend/src/styles/tokens.json`, kept
>   identical to the design system's, generates `frontend/src/styles/tokens.css` and `theme.css`
>   (`npm run tokens`). This file keeps the rules and the reasons, and its values must match.
> - The **Aveline Events** design-system artifact on claude.ai is its visual counterpart.
> - A change made in one place is made in all three in the same change, and
>   `npm run tokens:check` fails if the CSS drifts from the JSON.
>
> **Updated on 18 October 2026, with pointers only; no value changed.** The review findings that
> touch components (VR-29 to VR-36) are in [DESIGN_REVIEW.md](DESIGN_REVIEW.md). Where a
> question is open, build on the provisional defaults in
> [DESIGN_DECISIONS §6](DESIGN_DECISIONS.md#6-provisional-defaults).

## 1. Principles

1. **Quiet luxury.** A lot of ground, few colours, one signature shape. Elegance comes from
   proportion and type, not decoration.
2. **Type leads.** The serif carries the emotion and the sans carries the information. Hierarchy
   comes from size, weight and space before colour.
3. **One primary action per view.** On the invitation it is replying; everything else is quieter.
4. **Three scripts, equal.** Armenian, Russian and English are designed together. No layout
   depends on the length of one language, and no emphasis depends on a style that one script
   lacks.
5. **Accessible by construction.** Contrast, targets, focus and motion are tokens and rules, not
   checks done afterwards.

## 2. Colour

### 2.1 Three layers

| Layer | What it holds | Changes when |
|---|---|---|
| **Brand** | The designer's three colours, plus the logo's blush | Only when the designer changes the brief |
| **Semantic** | Roles: surface, text, heading, label, action, control edge, focus, state. Each role has a value in two themes, **Ivory** and **Bordeaux** | The design system changes |
| **Invitation theme** | A template palette's roles, mapped onto CSS custom properties per invitation | A host picks a palette |

### 2.2 Brand colours

| Token | Value | Status | Use |
|---|---|---|---|
| `brand-burgundy` | `#4F002B` | **Confirmed**, primary | Identity: the cover, headings on light, the primary action, dark bands |
| `brand-gold` | `#C5A477` | **Confirmed**, accent | **On light: ornament only** (hairlines, rules, frames, lozenges, swatch edges). **On burgundy:** labels and text |
| `brand-taupe` | `#B8A38E` | **Confirmed**, additional accent | **On light: ornament only.** **On burgundy:** secondary text and the edges of controls |
| `brand-blush` | `#FFEBF6` | **Seen in the logo; to confirm** (DQ-2) | Headings and the primary action on burgundy (R-3) |

### 2.3 Neutrals and derived colours

All recommended (R-2), pending the designer's approval (DQ-6).

| Token | Value | Use | Why this value |
|---|---|---|---|
| `ivory` | `#FBF7F1` | The page ground | A warm white, leaning toward the gold rather than grey |
| `porcelain` | `#FFFCF8` | Cards, the personal card, form surfaces | Lifts off ivory without needing a shadow |
| `linen` | `#F4ECE3` | Alternate bands, quiet fills, hover backgrounds | The deepest light ground that keeps every text role at AA |
| `sand` | `#EADFD3` | Decorative hairlines, disabled fills, the champagne cover | Decorative only |
| `ink` | `#241519` | Running text | Near-black with a burgundy undertone; 16.45 on ivory |
| `ink-muted` | `#6E5A61` | Secondary text, helper text | 5.97 on ivory, 5.44 on linen |
| `gold-ink` | `#7E6037` | Gold **as text** on light: labels | Gold deepened until it reaches 5.44 on ivory |
| `taupe-ink` | `#75614D` | Taupe **as text** on light | 5.51 on ivory |
| `line` | `#8A7A73` | **Edges of controls:** inputs, chips, outlined buttons | At least 3:1 on every light surface: 3.85 on ivory, 3.51 on linen |
| `burgundy-hover` | `#66003A` | Primary action, hover | Ivory text still reaches 12.10 |
| `burgundy-deep` | `#3A0020` | Primary action, pressed; deep bands | Ivory text reaches 16.39 |
| `burgundy-raised` | `#5E0A36` | A raised surface on burgundy | Every Bordeaux text role still passes AA |
| `selected-tint` | `#F1E8E8` | The ground of a selected choice | Burgundy at 8 % into porcelain; ink 14.58, burgundy 12.76 |
| `error-ink` | `#A3262E` | Error text, icons and edges on light | 6.85 on ivory. A brighter, more orange red than the brand burgundy, and always paired with an icon and words |
| `error-ink-hover` | `#7D1D23` | Error links on hover | 9.50 on ivory, 8.97 on the error tint. Added on 18 October 2026, when the canvas's one off-token colour became a token (VR-27) |
| `error-tint` | `#F9EFEC` | Error summary ground | Error text on it reaches 6.47 |
| `success-ink` | `#2F6B45` | Success text and icons on light | 5.94 on ivory |
| `success-tint` | `#F3F3ED` | Confirmation ground | Success text on it reaches 5.70 |
| `error-on-dark` | `#FFB4AB` | Error text on burgundy, rarely needed | 9.05 on burgundy |
| `success-on-dark` | `#B7E0C2` | Success text on burgundy | 10.57 on burgundy |

### 2.4 Semantic tokens

The **Ivory** theme is used for the letter and the app. **Bordeaux** is used for the cover, the
reply band, the footer, and in time a dark mode for the app.

| Token | Ivory | Bordeaux | Role |
|---|---|---|---|
| `surface` | `ivory` | `brand-burgundy` | The ground of a section |
| `surface-raised` | `porcelain` | `burgundy-raised` | Cards |
| `surface-sunken` | `linen` | `burgundy-deep` | Alternate bands, wells |
| `text` | `ink` | `ivory` | Running text |
| `text-muted` | `ink-muted` | `brand-taupe` | Secondary text |
| `heading` | `brand-burgundy` | `brand-blush` | Display type and headings |
| `label` | `gold-ink` | `brand-gold` | Small capital labels |
| `ornament` | `brand-gold` | `brand-gold` | Hairlines, lozenges, the arch frame. **Decorative only** |
| `hairline` | `sand` | `burgundy-raised` | Separators between list rows. Decorative |
| `control-edge` | `line` | `brand-taupe` | The edges of inputs, chips and outlined buttons |
| `action` | `brand-burgundy` | `brand-blush` | Primary button fill |
| `action-text` | `ivory` | `brand-burgundy` | Text on the primary button |
| `action-hover` | `burgundy-hover` | `brand-gold` | Primary button, hover |
| `action-pressed` | `burgundy-deep` | `brand-taupe` | Primary button, pressed |
| `focus` | `brand-burgundy` | `brand-blush` | The focus ring: 2 px, offset 2 px |
| `selected` | `selected-tint` | `burgundy-hover` | The ground of a selected choice |
| `error` | `error-ink` | `error-on-dark` | Error text and edges |
| `success` | `success-ink` | `success-on-dark` | Success text |

**Rules:**

- **Forms always sit on a light surface,** porcelain or ivory, even inside a burgundy band. The
  error and success colours are designed for light.
- **Gold and taupe never carry text on a light surface.** Use `gold-ink` or `taupe-ink` instead.
- **Colour never carries meaning alone.** Errors have an icon and words; a selection has a check
  mark and a heavier edge.
- **The invitation keeps its palette in dark mode** and declares `color-scheme: light` (R-16).

### 2.5 Invitation palettes

Proposed (R-28). They are for the template "Maison", once palettes have named roles (BQ-1, BQ-2).

| Role | `bordeaux` (default) | `champagne` |
|---|---|---|
| `ground` | `#FBF7F1` | `#F6F1EB` |
| `surface` | `#FFFCF8` | `#FFFCF8` |
| `ink` | `#241519` | `#241519` |
| `muted` | `#6E5A61` | `#6E5A61` |
| `primary` | `#4F002B` | `#4F002B` |
| `on-primary` | `#FBF7F1` | `#FBF7F1` |
| `accent` | `#C5A477` | `#C5A477` |
| `accent-2` | `#B8A38E` | `#B8A38E` |
| `cover` | `#4F002B` | `#EADFD3` |
| `on-cover` | `#FFEBF6` | `#4F002B` |
| `on-cover-label` | `#C5A477` | `#735530` |

**Champagne:** a light cover in sand, with burgundy names. Its contrast:

| Pair | Ratio |
|---|---|
| Burgundy names on the sand cover | 11.70 |
| Its labels, `#735530`, on sand | 5.21 |
| Ink on its ground | 15.63 |
| Muted text on its ground | 5.67 |
| Control edges on its ground | 3.66 |

Gold text would reach only 4.42 on sand, which is why its labels use the deeper gold.

**A proposed role order,** if the backend keeps palettes as plain lists:

`[ground, surface, ink, muted, primary, on-primary, accent, accent-2, cover, on-cover]`

## 3. Typography

### 3.1 Families

Confirmed (C-6). Each role is **composed from two families** (R-9):

| Role | Armenian characters from | Latin, Cyrillic, digits and punctuation from | Fallbacks |
|---|---|---|---|
| **Serif:** display, headings, numerals | Noto Serif Armenian | Noto Serif | Sylfaen, Georgia, serif |
| **Sans:** body, labels, interface | Noto Sans Armenian | Noto Sans | system-ui, sans-serif |

**Why compose them:**

- The Armenian families have **no Cyrillic, `№`, `₽` or narrow no-break space**, which English
  time formats use. So the base families must always be present.
- Their Latin is **the same design** as base Noto: 62 of 62 advance widths match. So splitting by
  script changes nothing visually.
- Splitting **downloads only what a page needs.**

The verified facts are in [BRAND_BRIEF §6](BRAND_BRIEF.md#6-typography).

**How it could be composed** (an illustration; the app does it differently, below):

```css
/* One family name per role. Armenian comes from the Armenian family; everything else from Noto Serif. */
@font-face {
  font-family: "Aveline Serif";
  src: url("/fonts/noto-serif-armenian.wght.woff2") format("woff2");
  font-weight: 100 900;
  font-display: swap;
  unicode-range: U+0530-058F, U+FB13-FB17;            /* Armenian, Armenian ligatures */
}
@font-face {
  font-family: "Aveline Serif";
  src: url("/fonts/noto-serif-latin.wght.woff2") format("woff2");
  font-weight: 100 900;
  font-display: swap;
  unicode-range: U+0000-024F, U+2000-206F, U+20AC, U+2122; /* Latin, punctuation, € ™ */
}
@font-face {
  font-family: "Aveline Serif";
  src: url("/fonts/noto-serif-cyrillic.wght.woff2") format("woff2");
  font-weight: 100 900;
  font-display: swap;
  unicode-range: U+0400-052F, U+2116, U+20BD;          /* Cyrillic, № ₽ */
}
/* "Aveline Sans" is composed the same way from Noto Sans Armenian and Noto Sans. */

:root {
  --font-serif: "Aveline Serif", "Noto Serif Armenian", "Noto Serif", Sylfaen, Georgia, serif;
  --font-sans: "Aveline Sans", "Noto Sans Armenian", "Noto Sans", system-ui, sans-serif;
  font-synthesis: none;            /* never fake an italic or bold Armenian has not got */
}
```

**Delivery:**

- Self-hosted WOFF2, variable on the weight axis only. All four families are OFL, so subsetting
  and self-hosting are allowed.
- **In code** (22 October 2026): `@fontsource-variable` packages supply the subsets, and the font
  stacks from `tokens.json` (the Armenian family first, then base Noto) do the composing instead
  of a merged family. Since the Armenian families' Latin matches base Noto's, Latin and digits
  come from them; Cyrillic, `№` and `₽` from base Noto. The look is the same; see
  `frontend/docs/ARCHITECTURE.md` §8.
- Generate the subsets from Google's own subset ranges.
- **Preload** only the serif subset for the page's language.
- The width axis (62.5–100 %) exists in all four families but is not used yet.

### 3.2 Scale

Mobile first. Sizes grow fluidly between 360 px and 1440 px with `clamp()`.

| Style | Family | Weight | Phone: size / line | Desktop: size / line | Tracking | Use |
|---|---|---|---|---|---|---|
| `display-xl` | Serif | 300 | 44 / 48 | 80 / 84 | −0.01 em (Armenian 0) | The hosts' names on the cover |
| `display-l` | Serif | 300 | 36 / 42 | 56 / 62 | −0.005 em (Armenian 0) | The not-found page, the reply confirmation |
| `heading-1` | Serif | 400 | 28 / 34 | 40 / 46 | 0 | Section headings (`h2`) |
| `heading-2` | Serif | 400 | 22 / 28 | 28 / 34 | 0 | Card titles (venue names), the greeting |
| `heading-3` | Serif | 500 | 18 / 24 | 20 / 26 | 0 | Question legends in the form |
| `numeral-l` | Serif | 300 | 44 / 44 | 64 / 64 | 0 | Countdown digits |
| `numeral-m` | Serif | 400 | 20 / 24 | 22 / 26 | 0 | Timeline times |
| `lead` | Sans | 400 | 18 / 30 | 20 / 32 | 0 | The first paragraph of the story |
| `body` | Sans | 400 | 16 / 26 | 17 / 28 | 0 | Running text |
| `small` | Sans | 400 | 14 / 22 | 14 / 22 | 0 | Helper text, captions |
| `eyebrow` | Sans | 500, capitals | 12 / 16 | 13 / 18 | 0.16 em (Armenian 0.08 em) | Small labels such as "WEDDING" or "CEREMONY" |
| `button-text` | Sans | 500, capitals | 14 / 20 | 14 / 20 | 0.12 em (Armenian 0.06 em) | Buttons |
| `field-text` | Sans | 400 | **16** / 24 | 16 / 24 | 0 | Form fields. 16 px stops iOS zooming on focus |
| `caption` | Sans | 400 | 12 / 18 | 12 / 18 | 0.02 em | Fine print |

### 3.3 Language adjustments

```css
:lang(hy) {
  --leading-body: 1.7;     /* 1.625 elsewhere: Armenian descends deeper (to −265 in the serif) */
  --tracking-label: 0.08em;
  --tracking-button: 0.06em;
  --tracking-display: 0;
}
```

- **Armenian lowercase stands about 8 % lower** than Latin at the same size (492–502 against
  536). Keep the same font size, so the hierarchy stays identical, and give it more line height.
  Do not enlarge it.
- **Capitals with tracking** are used in all three scripts for consistency (C-6). Tracking is
  tighter for Armenian, pending a native reader's review (DQ-9).
- **No italic carries meaning,** in any language: Armenian has none. Emphasis uses weight or
  colour (R-10).
- **No small capitals:** none of the four families has `smcp`. Use real capitals at the `eyebrow`
  size instead.
- **Long words:** `overflow-wrap: anywhere` on narrow containers. Headings use
  `text-wrap: balance` and body text `text-wrap: pretty`. Automatic hyphenation is not relied on,
  because browser support for Armenian is uneven.

### 3.4 Numerals and symbols

- **Digits are tabular by default in all four families,** so countdowns and times do not shift. No
  `font-variant-numeric` is needed.
- **Arrows and check marks are SVG icons.** No family has `→` or `✓`.
- **`№` and `₽`** come from the base families through the stack.
- **The dram sign `֏`** comes from the Armenian families. Money is not shown on the invitation.

## 4. Space, layout and breakpoints

### 4.1 Spacing

Base 4 px.

| Token | `space-1` | `space-2` | `space-3` | `space-4` | `space-5` | `space-6` | `space-8` | `space-10` | `space-12` | `space-16` | `space-20` | `space-24` | `space-32` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| px | 4 | 8 | 12 | 16 | 20 | 24 | 32 | 40 | 48 | 64 | 80 | 96 | 128 |

| Spacing between | Phone | Desktop |
|---|---|---|
| Sections | `space-16` to `space-20` | `space-24` to `space-32` |
| A label and its heading | `space-3` | `space-3` |
| A heading and its content | `space-6` | `space-6` |
| Inside cards | `space-6` | `space-8` |
| Form fields | `space-6` | `space-6` |
| Choice cards | `space-3` | `space-3` |

### 4.2 Breakpoints

The Tailwind defaults, so the app's Tailwind 4 setup needs no custom screens.

| Name | From | Typical device | Design frame |
|---|---|---|---|
| base | 0 | Phones | 360 × 800 and 390 × 844. Tested down to 320 |
| `sm` | 640 | Large phones, small tablets | n/a |
| `md` | 768 | Tablets, portrait | 768 × 1024 |
| `lg` | 1024 | Tablets in landscape, laptops | The open-card layout starts |
| `xl` | 1280 | Desktops | 1440 × 900 |
| `2xl` | 1536 | Large desktops | Content stops growing |

### 4.3 Widths and grids

| Item | Value |
|---|---|
| Gutters | 16 px below 360; 20 px on phones; 32 px at `sm`; 40 px at `md`; 64 px at `lg` and up |
| Text measure | At most 34 rem of running text, about 65 characters |
| Invitation column | 34 rem on phones; 40 rem at `md`; 42 rem in the open card |
| Open card | The cover panel takes 5/12 (420–640 px); the letter takes 7/12 |
| Grids | 4 columns on phones (16 px gaps), 8 at `md` (24 px), 12 at `lg` and up (24–32 px). The future app adds a 72 rem page width |

### 4.4 Phone details

- **Viewport units:** `svh` and `dvh`, never `vh`.
- **Safe areas:** fixed bars add `env(safe-area-inset-bottom)` and `env(safe-area-inset-top)` to
  their own padding.
- **The reply bar** reserves its height with `scroll-padding-bottom`.
- **In-app browsers** (Telegram, WhatsApp, Instagram) cover the bottom of the screen with
  toolbars. Nothing important lives in the last 56 px unless it is in the reply bar.

## 5. Shape, lines and elevation

| Token | Value | Use |
|---|---|---|
| `radius-none` | 0 | **The default:** buttons, cards, fields, images, chips (R-4) |
| `radius-hair` | 2 px | The focus ring's corners only |
| `radius-arch` | 9999 px on the **top corners only** | The arch frame (R-5) |
| `stroke-hairline` | 1 px | Separators, card edges, control edges, the frame around the arch. Its colour is `hairline`, `control-edge` or `ornament` by role |
| Gold rule (a pattern, not a token) | 1 px of `ornament`, 48–96 px long | Section ornament, beside a lozenge |
| Lozenge (a pattern, not a token) | A 6 px square turned 45°, in `ornament` | The divider's centre, timeline markers |
| `shadow-float` | `0 8px 24px -12px rgb(36 21 25 / 0.28)` | The reply bar and the floating music control |
| `shadow-card` | `0 12px 32px -20px rgb(36 21 25 / 0.25)` | The personal card where it overlaps the cover |

**The arch (R-5):**

- A rectangle whose top corners are rounded to half its width, so the top is a semicircle.
- The photograph fills it with `object-fit: cover`, at about 4:5 below the curve.
- A gold hairline follows its outline 8 px outside it.
- **Use it in two places only:** the cover photograph, and around the hosts' signature when a
  SIGNATURE block exists.

**Ornament (R-6):**

- Hairlines, the lozenge and the arch.
- None of: drawn flourishes, florals, textures, gradients, glass effects or drop shadows on text.

## 6. Imagery

**Direction (R-7, DQ-7):**

- Editorial and documentary.
- Natural light; warm but true colour.
- Subjects: people and details, such as hands, tables, flowers, fabric and architecture.
- Calm compositions with room around the subject.

**Ratios:**

| Where | Ratio |
|---|---|
| The cover arch | About 4:5, plus the curve |
| The full-bleed cover | Fills the screen; the subject sits in the middle third |
| Gallery | 4:5, 1:1 and 3:2 |
| Story photograph | 4:5 on phones, 3:4 beside the text |

**Host photographs:**

- Shown **as uploaded:** no filters or tints, and no cropping beyond `object-fit`.
- **Hosts are advised** to choose a cover whose subject is centred, because link previews crop it
  to 1.91:1.

**Text over photographs:**

- Only in the `full-bleed` cover, on a dark gradient rising from the bottom.
- Checked against the lightest part of the photograph.

**Performance:**

- `loading="lazy"` below the first screen; `sizes` on every image.
- Until F18 there is no resizing, so large originals cost every guest. Hosts are asked to upload
  photographs of 2–3 MB or less.

**Alt text:** `altText` when there is one; empty when there is none (F11).

**Mockups:** use registered placeholders only ([PLACEHOLDER_IMAGES.md](PLACEHOLDER_IMAGES.md)).
The design system itself contains no third-party photographs.

## 7. Icons

**Style:**

- Lucide line icons (the app's set), with a 1.5 px stroke.
- Sizes: 20 px in text and controls, 24 px alone.
- Coloured with `currentColor`.

**The invitation uses:**

| Icon | Use |
|---|---|
| `map-pin` | Venues |
| `clock` | Times |
| `calendar` | The date |
| `phone` | Contact |
| `message-circle` | Chat |
| `volume-2`, `volume-x` | Music on and off |
| `globe` | Language |
| `chevron-down` | Expanding sections |
| `arrow-right`, `external-link` | Links out |
| `copy` | Copy address |
| `check` | Selected |
| `plus`, `minus` | Adding and removing guests |
| `circle-alert` | Errors |
| `info` | Notices |
| `loader` | Sending |

**Rules:**

- No emoji. No icon without a label, except the music control, which has an accessible name and a
  visible state.
- Arrows are icons, never characters.

## 8. Motion and sound

| Token | Value |
|---|---|
| `duration-fast` | 150 ms: colour and border changes |
| `duration-base` | 200 ms: expanding sections, state changes |
| `duration-slow` | 600 ms: the cover settling on load |
| `ease-out` | `cubic-bezier(0.2, 0.7, 0.2, 1)` |
| `ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` |

**Rules:**

- **Content is complete at rest.** Motion adds a rise of 8 px at most, never a reveal from hidden.
- **Under `prefers-reduced-motion`,** nothing moves.
- **No** parallax, bouncing or autoplaying video.
- **Sound:** music only (R-20). It never starts on its own, has an explicit control, and pauses
  when the page is hidden.

## 9. Components

These are the components the invitation needs. Each is previewed in the design-system artifact on
both themes.

| Component | Anatomy | Variants | Notes |
|---|---|---|---|
| **Button** | A label in capitals; an optional icon | **Primary:** filled `action`. **Secondary:** a 1 px `action` outline. **Quiet:** text with an underline | 48 px tall (44 at least), square corners, 20–24 px side padding. Full width in the reply bar and on phones |
| **Link** | Text with a 1 px underline, offset 3 px | Inline, standalone, external (with an icon) | Burgundy on light, blush on burgundy |
| **Reply bar** | Porcelain, a hairline above, a button or a status chip with a button | Not answered, answered | Phones and tablets only; obeys R-14 |
| **Music control** | An icon and a word | Off, on, floating while on | A `button` with `aria-pressed`, 44 × 44 at least |
| **Language switcher** | A globe icon, the current language's own name, a list | Closed, open | Only where switching works (R-17) |
| **Label and heading** | An `eyebrow` in capitals, then a heading | Left-aligned, centred | Its structure follows the content; never a decorative number |
| **Divider** | A hairline, a lozenge, a hairline, in `ornament` | Short (48 px rules), long (96 px) | At most twice a page |
| **Arch frame** | A photograph in the arch, with a gold hairline 8 px outside | Cover, signature | §5 |
| **Personal card** | A label, the greeting, a sentence, seats and names, a status chip, a button | Not answered, answered | Porcelain, with a hairline and `shadow-card` |
| **Venue card** | The role label, the name in `heading-2`, the address, the arrival time, the actions | Card, list row | The address is selectable; **Copy address** |
| **Timeline** | The time (`numeral-m`), the label, the gold line and lozenges | Vertical, compact | Day headings when entries span more than one day |
| **Countdown** | Four groups of `numeral-l` with labels | Numerals, one line of days | Rendered after hydration, never announced |
| **Swatches** | 36 px squares with a hairline edge | n/a | `role="img"` and a label |
| **Choice card** | A radio button, the label, an optional line below | Default, hover, focus, selected, disabled | Covers its whole width; selected shows a 2 px `action` edge, the `selected` ground and a check |
| **Member control** | The name, then three segments | Attending, Not attending, Not sure | A radio group per person |
| **Chip** | A checkbox and a label | Default, selected (filled `action` with a check), disabled | Multiple choice: dietary needs, the host's questions |
| **Text field and text area** | A label above, the field, help or an error below, a counter | Default, focus, filled, error, disabled | 48 px tall; 16 px text; porcelain, with a 1 px `control-edge` |
| **Error summary** | An icon, a heading, links to each problem | n/a | `error-tint`, a full 1 px `error` border. Receives focus when a send fails |
| **Notice** | An icon, a sentence, an optional action | Information (closed), success (sent), error | A full border, never a single coloured side |
| **Status chip** | A small square marker and a capital label | Attending, not attending, not sure | Marked by an icon and the word, not colour alone |
| **Footer mark** | The logo file on burgundy, cropped to its clear space | n/a | No words. The minimum size is in [BRAND_BRIEF §3.4](BRAND_BRIEF.md#34-usage-rules) |

## 10. Interaction states

| State | How it looks | Applies to |
|---|---|---|
| **Default** | As in §9 | All |
| **Hover** (pointer devices only) | Primary goes to `action-hover`. Secondary and chips get a `linen` ground and an `action` edge. Links thicken their underline to 2 px | Buttons, links, cards, chips |
| **Focus** (keyboard) | A 2 px `focus` ring, offset 2 px, never removed. Shown with `:focus-visible` | Everything interactive |
| **Pressed** | Primary goes to `action-pressed`. Nothing moves | Buttons, chips, choice cards |
| **Selected** | A 2 px `action` edge, the `selected` ground and a check mark. Chips fill with `action` | Choice cards, chips, segments |
| **Disabled** | A `sand` ground with `ink-muted` text (4.85). No hover. The reason is given in text nearby | Buttons, fields |
| **Loading** | The label reads "Sending…" with a turning `loader` icon. The width stays fixed. `aria-busy="true"`; repeat presses are ignored | Primary buttons |
| **Error** | A 1 px `error` edge, an icon and a message below, linked with `aria-describedby` | Fields, groups |
| **Success** | A `success` icon and words in a notice. Focus moves to its heading | The reply confirmation |

## 11. Accessibility

**The target is WCAG 2.2 AA.**

**Contrast** (every value computed):

| Pair | Ivory | Bordeaux |
|---|---|---|
| Text on its surface / raised / sunken | 16.45 / 17.16 / 15.01 | 14.39 / 12.51 / 16.39 |
| Muted text on its surface / raised / sunken | 5.97 / 6.23 / 5.44 | 6.34 / 5.51 / 7.22 |
| Headings on surface / raised | 14.39 / 15.02 | 13.51 / 11.74 |
| Labels on surface / raised / sunken | 5.44 / 5.68 / 4.97 | 6.55 / 5.69 / 7.45 |
| Control edges on surface / raised (≥ 3:1) | 3.85 / 4.02 (sunken 3.51) | 6.34 / 5.51 |
| Text on the primary action / hover / pressed | 14.39 / 12.10 / 16.39 | 13.51 / 6.55 / 6.34 |
| Focus ring on surface / raised | 14.39 / 15.02 | 13.51 / 11.74 |
| Text on a selected choice | 14.58 | n/a |
| Error on surface / raised | 6.85 / 7.14 | 9.05 (`error-on-dark`) |
| Success on surface / raised | 5.94 / 6.20 | 10.57 (`success-on-dark`) |
| Gold or sand hairlines on ivory | 2.20 / 1.23: **decorative only** | n/a |

**Other rules:**

| Area | Rule |
|---|---|
| Touch targets | At least 44 × 44 CSS px; 48 px tall for primary buttons; at least 8 px between neighbouring targets |
| Focus | Always visible (§10); the order follows reading order; focus is never trapped. The reply bar never hides the focused field |
| Forms | A real `label` for each field. A `fieldset` and `legend` for each group. Required written in words. Errors in text, linked to their field, summarised on send |
| Language | `lang` on `<html>` from the response. Content in any of the three scripts reads correctly with the composed fonts |
| Reflow | Works at 320 px and at 200 % text zoom with no sideways scrolling. Text containers never have fixed heights |
| Motion and sound | §8. Nothing flashes |
| Testing | Axe in the end-to-end tests, guest pages first (setup proposal §12). Manual checks with VoiceOver on iOS and TalkBack on Android, in all three languages |

## 12. From invitation to dashboard

The same tokens will serve the organiser app, which uses shadcn/ui (C-14). Its CSS variables map
like this:

| shadcn/ui variable | Aveline token |
|---|---|
| `--background` / `--foreground` | `ivory` / `ink` |
| `--card`, `--popover` / their foregrounds | `porcelain` / `ink` |
| `--primary` / `--primary-foreground` | `brand-burgundy` / `ivory` |
| `--secondary` / `--secondary-foreground` | `linen` / `ink` |
| `--muted` / `--muted-foreground` | `linen` / `ink-muted` |
| `--accent` / `--accent-foreground` | `selected-tint` / `brand-burgundy` |
| `--destructive` | `error-ink` |
| `--border` | `sand` (decorative separators) |
| `--input` | `line` (control edges, at least 3:1) |
| `--ring` | `brand-burgundy` |
| `--radius` | `0` or `2px` |

**Differences in the app:**

- **Denser:** body 14–15 px, `space-4` gaps, 40 px controls (still 44 px targets on touch).
- **Serif only for page titles.** Gold is used sparingly.
- **A dark mode** can later build on the Bordeaux theme; it is not designed yet.
- **Charts** follow the `dataviz` skill when they arrive.

## 13. Where the system lives

| Place | Holds | Status |
|---|---|---|
| This file | The written system: rules, rationale, and the values for reference | The source of truth for rules; values must match the code |
| **"Aveline Events"**, a design-system artifact on claude.ai | Tokens (`tokens.json`), the brand book, component previews, the logo | The visual counterpart. Private until shared. Its link is in the table below. Its page generates its own `tokens.css` for the previews; we never write that file |
| `frontend/src/styles/tokens.json` → `tokens.css` and `theme.css` | The tokens as CSS custom properties (Ivory on `:root`, Bordeaux under `[data-theme="bordeaux"]`), and the Tailwind 4 `@theme` mapping with one utility per type style | **The source of truth for values in code.** Generated by `npm run tokens`; never edited by hand. The canvas carries a copy of `tokens.css`, which its boards read |

**Artifact links:**

| Artifact | Link |
|---|---|
| Design system | [**Aveline Events**](https://claude.ai/artifact/6qY7NZvDFBmnF4XnKeDawo): the brand book, `tokens.json` (Ivory and Bordeaux themes), 21 component previews with guidelines, the logo. First published 13 October 2026, version `1791837143-7e7e` |
| Invitation canvas | See [GUEST_INVITATION §14](GUEST_INVITATION.md#14-the-artboards). The canvas has this system installed |
| Review | [**Aveline Design Review**](https://claude.ai/artifact/XGY21GRtMK6JFueWda51YM): the 13 October visual review as first published. A snapshot; [DESIGN_REVIEW.md](DESIGN_REVIEW.md) supersedes it. Latest versions of all three: [README §3](README.md#3-the-artifacts) |

Both artifacts are **private**: they open only for their owner until shared from the page's Share
menu. Share them with the designer and the backend developer when they should review them. Share
the canvas only within the team while it holds placeholder photographs.

**Keeping them in step:**

- A change made on the artifact, by a person or an agent, is written here in the same change, and
  the other way round.
- Once components exist in code, the `/design-sync` skill can keep a claude.ai design system in
  step with them, one component at a time.

## 14. Not yet built

| Missing | Notes |
|---|---|
| Font preloading for the page's language | §3.1. The fonts are self-hosted through `@fontsource-variable` packages, split by script; nothing is preloaded yet |
| The template "Maison" as data | R-27 to R-29. The renderer and the components are built in `frontend/src/` (22 October 2026); the template row is the backend's |
| Structured desktop type sizes in `tokens.json` | Desktop sizes exist only in each style's usage note; the app's generator reads them from there ([ARCHITECTURE §8](../ARCHITECTURE.md#8-styling-tokens-and-fonts)). A `desktop` field per style would be sturdier: a request to the designer |
| Storybook and visual tests | A10 in the setup proposal |
| A dark mode for the app | n/a |
| Logo files beyond the supplied PNG | DQ-1 to DQ-4 |
| Approval of every recommendation here | DQ-6, DQ-7, DQ-10 |
| The review's component fixes, and approval of their directions | [DESIGN_REVIEW §5](DESIGN_REVIEW.md#5-fixes), DQ-12, PD-27 to PD-37 |
