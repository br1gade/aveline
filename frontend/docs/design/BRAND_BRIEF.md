# Aveline Events: brand brief

> **Status: confirmed by the designer.** Received on 12 October 2026 through the frontend lead.
> Written on 13 October 2026.
>
> This file holds only two things: what the designer decided, and facts verified about the files
> they supplied. Recommendations, assumptions and open questions live in
> [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md). Change this file only when the designer changes the
> brief.

## This folder

The index of this folder, the private claude.ai artifacts and the current state of the design are
in [README.md](README.md).

---

## 1. Name and tagline

| | |
|---|---|
| Brand name | **AVELINE EVENTS** |
| Tagline | **Your Dream Event Planner.** |

The tagline was supplied in English only. Whether it is translated is an open question (DQ-5 in
[DESIGN_DECISIONS.md](DESIGN_DECISIONS.md#5-unresolved-questions)).

## 2. Personality and positioning

As supplied:

- Elegant, timeless, sophisticated.
- Inspired by European luxury brands such as Dior and Cartier.
- Classic, elegant serif typography combined with a modern, minimalist approach.
- Premium and refined rather than flashy, overly decorative, or generic.

## 3. Logo

### 3.1 What is confirmed

The supplied PNG **is** the logo. Its drawing, proportions and appearance are preserved: it is
not redesigned, redrawn, re-typeset, recoloured or replaced.

### 3.2 The supplied file

Inspected on 12 October 2026. Nothing was modified; the copy in `assets/` is byte-identical.

| Property | Value |
|---|---|
| File | [`assets/aveline-events-logo.png`](assets/aveline-events-logo.png) |
| SHA-256 | `9b96b4e0150c7ea071febe04db25e69193d17999320107a0166a2b13f8b8356b` |
| Canvas | 4500 × 5625 px, a 4:5 portrait, 300 dpi |
| Pixels | RGB with an alpha channel, but every pixel is fully opaque. **The background is part of the file** |
| Background | `#4F002B`, exactly the primary brand colour |
| Wordmark colour | `#FFEBF6`, a pale blush. **It is not one of the three supplied colours**; see DQ-2 |
| Lines | Two: `AVELINE` above `EVENTS` |

**Lockup geometry,** measured in source pixels:

| Element | Horizontal span | Vertical span | Size |
|---|---|---|---|
| `AVELINE` | 1042–3592 | 2358–2732 | 2550 × 374 |
| `EVENTS` | 2660–3564 | 2932–3082 | 904 × 150 |
| The lockup | 1042–3592 | 2358–3082 | 2550 × 724, about **3.52 : 1** |

**Its drawing:**

- **`AVELINE`** is set in capitals in a high-contrast display serif. Its terminals flare like a
  pen stroke, and the `A` has a hairline crossbar. The hairlines are what disappear first at small
  sizes.
- **`EVENTS`** is set in capitals in a light geometric sans with wide letter-spacing. Its cap
  height is **0.40×** that of `AVELINE`. It is set to the right, and its last letter stops 28 px
  short of `AVELINE`'s right edge, which is optical alignment rather than a measuring error.
- **The gap** between the two lines is 200 px, **0.53×** `AVELINE`'s cap height.

**Its place on the canvas:** the lockup's centre sits 67 px right of and 92 px above the canvas
centre. The file is a finished composition in the shape of a portrait social post, not a trimmed
logo.

### 3.3 What the file can and cannot do yet

- **It can** sit on a field of exactly `#4F002B` with no visible edge, because its background is
  that colour. A screen crops it to the lockup and its clear space with CSS. The file itself is
  never edited.
- **It cannot** sit on any other colour or on a photograph: it would show its burgundy rectangle.
- **There is no:**
  - transparent or vector version;
  - single-colour or reversed version;
  - small mark for favicons and app icons.

  These are requested from the designer (DQ-1, DQ-3 and DQ-4).

### 3.4 Usage rules

**Confirmed:** never redesign or replace the logo, and preserve its proportions and appearance.

**Recommended until the designer confirms them** (DQ-1):

| Rule | Value |
|---|---|
| Clear space | At least one `AVELINE` cap height (**H**) on every side. That is 374 px at source scale, 14.7 % of the lockup's width |
| Minimum size on screen | The lockup at least **140 CSS px** wide. `EVENTS` then has a cap height of about 8 px, the smallest at which its thin strokes survive |
| Minimum size in print | The lockup at least **35 mm** wide |
| Ground | Only `#4F002B` until other colourways exist |

**Never:**

- stretch, squash, rotate or recolour it;
- add a shadow, glow, outline or gradient;
- retype the wordmark in a font;
- separate `AVELINE` from `EVENTS`;
- place it over a photograph.

## 4. Colours

| Role | Value |
|---|---|
| Primary | **`#4F002B`** |
| Accent | **`#C5A477`** |
| Additional accent | **`#B8A38E`** |

These exact values are preserved. Every other colour in this folder is a recommendation and is
labelled as one.

**Verified contrast** (WCAG relative luminance, computed on 12 October 2026). The ivory column
uses `#FBF7F1`, the page colour recommended in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#2-colour):

| Foreground | On `#FFFFFF` | On ivory `#FBF7F1` | On `#4F002B` |
|---|---|---|---|
| `#4F002B` primary | 15.36 | 14.39 | n/a |
| `#C5A477` accent | **2.35** | **2.20** | 6.55 |
| `#B8A38E` additional accent | **2.42** | **2.27** | 6.34 |
| `#FFEBF6` logo ink | 1.14 | 1.07 | 13.51 |

WCAG AA asks for 4.5:1 for text, and 3:1 for large text, icons and the edges of controls.

- **Both accents fail** as text, as icons and as control edges on light backgrounds. On light, they
  can only be ornament: hairlines, rules, swatches.
- **On burgundy, both pass** as text.

How this shapes the palette is in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#2-colour).

## 5. Languages

**Armenian, Russian and English**, fully supported. The API uses the codes `hy`, `ru` and `en`.

## 6. Typography

| Role | Families |
|---|---|
| Headings | **Noto Serif Armenian / Noto Serif** |
| Body text | **Noto Sans Armenian / Noto Sans** |

The designer requires consistent typography, visual hierarchy, weights, spacing and readability
across all three languages.

### 6.1 Verified font facts (12 October 2026)

**Method:**

- The Google Fonts CSS2 API was queried for styles, axes and subsets.
- The served TTF files were parsed directly: `cmap`, `OS/2`, `hhea`, `hmtx`, `glyf`, `GSUB` and
  `GPOS`.
- The licences were read from each family's `METADATA.pb` in the `google/fonts` repository.

| | Noto Serif Armenian | Noto Sans Armenian | Noto Serif | Noto Sans |
|---|---|---|---|---|
| Armenian capitals U+0531–0556 | 38 / 38 | 38 / 38 | none | none |
| Armenian small letters U+0561–0587 (with `և`) | 39 / 39 | 39 / 39 | none | none |
| Armenian punctuation `ՙ ՚ ՛ ՜ ՝ ՞ ՟`, `։`, `֊` | yes | yes | no | no |
| Dram sign `֏`, eternity signs `֍ ֎` | yes | yes | no | no |
| Armenian ligatures U+FB13–FB17 | yes | yes | no | no |
| Basic Latin and digits | yes | yes | yes | yes |
| `« »`, curly quotes, en and em dash, `…`, `·`, `•`, `×` | yes | yes | yes | yes |
| Cyrillic `А–я`, `Ё ё` | **no** | **no** | yes | yes |
| `№`, `₽` | **no** | **no** | yes | yes |
| Thin space U+2009, narrow no-break space U+202F | **no** | **no** | yes | yes |
| Arrow `→`, check mark `✓` | no | no | no | no |
| Styles | **upright only** | **upright only** | upright and italic | upright and italic |
| Weights | 100–900, variable | 100–900, variable | 100–900, variable | 100–900, variable |
| Width axis | 62.5–100 % | 62.5–100 % | 62.5–100 % | 62.5–100 % |
| Substitution features (`GSUB`) | `ccmp liga locl` | `ccmp liga locl` | `ccmp dnom frac liga locl numr pnum rtlm tnum` | the same, plus Indic features |
| Licence | OFL | OFL | OFL | OFL |

**Metrics,** in a 1000-unit em:

| Metric | Value |
|---|---|
| Ascender / descender | 1068 / −292 in the Armenian families; 1069 / −293 in Noto Serif and Noto Sans |
| Cap height | 714 in all four |
| x-height | 536 in all four |
| Armenian lowercase height | 492–502, against 536–546 for Latin |
| Armenian descenders | Down to −265 in the serif and −236 in the sans; the Latin `p` reaches −240 |

**Facts that follow from the files:**

- **The Latin is the same design in both families.** The Latin glyphs in the Armenian families
  have the same advance widths as Noto Serif and Noto Sans: 62 of 62 checked, A–Z, a–z and 0–9.
- **Digits are tabular by default in all four:** every digit is 559 units wide in the serifs and
  572 in the sans faces.
- **Armenian reads about 8 % smaller** than Latin at the same font size, and many lowercase
  letters descend (`բ ր փ ֆ ղ ց` and more).
- **Russian text, `№` and `₽` always come from Noto Serif or Noto Sans,** and so does the narrow
  space that English time formats use.
- **Armenian has no italic or small capitals to fall back on.** A browser would fake them.

What the design system does about these facts is in
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#3-typography).

## 7. Not in the brief

Nothing in this list has been decided by the designer:

- photography direction;
- iconography;
- motion;
- ornament and patterns;
- tone of voice;
- any display or secondary typeface;
- dark mode;
- logo colourways and a small mark;
- tagline translations;
- colours beyond the three, including neutrals, text and state colours.

Where the design needed one of these, [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) records a
**recommendation**, never a decision.

## 8. Not yet supplied

Requested from the designer:

1. The logo master as vector (SVG or PDF), and a transparent PNG.
2. Confirmation that `#FFEBF6` is the intended wordmark colour, and whether it counts as a brand
   colour.
3. Approved colourways for light grounds and a single colour, and a small mark for favicons and
   app icons.
4. The tagline in Armenian and Russian, or a rule that it stays in English.
5. Approval or correction of the recommended neutrals and derived colours.
