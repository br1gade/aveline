# Reference analysis

> **Status: research record.** Written on 13 October 2026 from local copies made on 9 October 2026.
> The references were made anonymous on 23 October 2026, before the file was first committed.
>
> **Rule:** the references are inspiration only. This file describes their patterns in our own
> words and copies nothing from them: no text, code, colour values, fonts, logos or images. Their
> photographs appear only as placeholders on the private design canvas, by the frontend lead's
> decision of 12 October 2026, and every one is registered for replacement in
> [PLACEHOLDER_IMAGES.md](PLACEHOLDER_IMAGES.md).

## 1. Method

The two reference sites given with the design brief: marketing sites of wedding and event
planners. They are called **Reference A** and **Reference B** here.

| | Reference A | Reference B |
|---|---|---|
| What they are | A wedding planner's site: one long page | A wedding and event planning and design studio's site: several pages |
| How it is built | Static HTML with one stylesheet of design tokens and a small script | A single-page app |

**The repository does not name them.** It is public, and root `CLAUDE.md` keeps research sources
on local disk. Which sites they are, and the local copies studied, are recorded in
`docs/design/research/REFERENCE_SOURCES.md`, which git ignores and which exists only on the
frontend lead's machine.

**What was inspected:**

- page structure and section order;
- the type scale, spacing and breakpoints;
- the photographs (format, ratio, subject, colour grade);
- font loading;
- accessibility features.

**The focus,** as the brief asks: layout, typography, whitespace, imagery, visual hierarchy,
decorative detail, responsive behaviour, and how luxury planning services are presented.

---

## 2. Reference A

### Layout and hierarchy

- **One long page of about a dozen sections:**
  1. a split hero, with copy on one side and a framed portrait on the other;
  2. an "at a glance" strip;
  3. problems, then the solution;
  4. reasons to choose them, on a dark band;
  5. a five-step process;
  6. services;
  7. destinations;
  8. testimonials;
  9. a portfolio mosaic;
  10. an FAQ;
  11. a contact form on a dark band;
  12. the footer.
- **Every section opens the same way:** a small label, a large serif headline, then a lead
  paragraph. The hierarchy never varies, so the page reads calmly.
- **Rhythm:** a dark band breaks the light warm ground every few screens.
- **Whitespace is generous and fluid.** Section padding grows from about 72 px on a phone to about
  128 px on a wide screen. Content stops at about 1200 px, and side gutters run from about 20 to
  64 px.

### Typography

- **Headings** are in a soft, high-contrast display serif at regular-to-medium weight, with tight
  leading and slightly negative tracking. One or two words in a headline turn italic and take the
  accent colour.
- **Body text** is in a neutral grotesque sans, around 16–17 px with a line height of about 1.65.
- **Section labels** are tiny, semi-bold capitals tracked at about 0.2 em, in the accent colour,
  led by a short accent rule.

### Colour

- A warm off-white paper ground, with two deeper paper tints for alternating sections.
- Near-black warm text and a muted secondary text colour.
- An antique gold for rules, numerals and icons; a dark espresso brown for dark bands.

### Imagery

- **Portrait crops in 4:5 frames,** with slightly rounded corners, a long soft shadow and a hairline
  border set about 12 px inside the edge, like a passe-partout.
- **Photographs** have a warm, soft, film-like grade with a slight rose cast and natural light.
  Subjects: a couple under classical columns, table flowers, old stone architecture. Several look
  like stock photography. The sources are phone-portrait 9:16 files.

### Decorative details

- A **circular monogram seal** with italic serif initials, used as a signature and on a small card
  floating over the hero photograph.
- **Process steps** numbered with large italic serif numerals in gold, separated by hairlines.
- Hairline rules and thin line icons throughout; no ornament beyond these.

### How the services are presented

- A centred heading block: label, headline, lead.
- **About ten cards** in an auto-fit grid. Each has a gold line icon, a short title and two
  sentences.
- Cards reveal one after another as the page scrolls. On hover they lift, and a thin gold bar grows
  along one edge.
- The process (five numbered steps) is a separate section, so the "what" and the "how" stay apart.

### Components and interaction

- **Buttons:** pill-shaped, a dark filled primary and an outlined ghost. On hover they lift 2 px
  and turn gold; arrow icons point onward.
- **Other parts:**
  - a flag-based language switcher;
  - an accordion FAQ with a rotating plus;
  - location chips with icons;
  - a contact form with uppercase labels and a custom checkbox.

### Mobile and accessibility

- **Below about 980 px,** split layouts stack, with the image first and narrowed.
- **Below about 760 px:**
  - the navigation becomes a full-screen overlay menu;
  - a **sticky bottom bar** slides in with a short line of text and a call to action;
  - form rows stack;
  - the portfolio mosaic becomes two columns of squares.
- **Accessibility:**
  - a skip link and visible focus outlines;
  - sections fade up as they enter, and that motion is switched off under reduced-motion settings.

---

## 3. Reference B

### Layout and hierarchy

- **The services page:**
  1. a compact three-column grid of service categories, drawn with 1 px hairline gaps instead of
     boxes;
  2. a full-bleed photograph under a dark wash, carrying a translucent, blurred panel with six
     numbered principles in two columns;
  3. an "explore" block: a very large headline beside a short paragraph, over two tall image cards
     (weddings and events).
- **The home page:** an oversized headline beside one tall portrait photograph.
  - **On phones** the photograph is 4:5 and capped at about 62 % of the viewport height, and a band
    of two calls to action sits under it.
  - **On wide screens** the photograph is 2:3 at about 78 % of the viewport height.
- **Whitespace is very generous:** short blocks of text in narrow containers, with long vertical
  gaps.

### Typography

- **A very thin, wide display serif in capitals,** tracked at about 0.14–0.18 em, for card titles
  and short signature phrases.
- **Huge headlines** in a refined serif with very tight leading (about 0.92) and negative tracking,
  scaling fluidly from roughly 3.3 rem on phones to nearly 10 rem on wide screens.
- **Navigation and labels** in tiny serif capitals (10–13 px), tracked at 0.15–0.3 em and dimmed
  to 60–70 % opacity.
- **Body text** in a light humanist sans.

### Colour

- A pale warm grey-white ground and near-black text.
- **A champagne gold accent within a few RGB points of Aveline's `#C5A477`.** So gold on white
  cannot be what identifies Aveline; burgundy has to do that.

### Imagery

- Editorial, documentary wedding photography:
  - tablescapes with candelabra and white flowers;
  - draped silk;
  - frescoed historic interiors;
  - couples in natural light.
- 2:3 portraits and 3:2 landscapes, with a natural, restrained grade.
- Images that carry text have a dark gradient rising from the bottom, so white type can sit on them.

### How the services are presented

- **Categories first,** as a terse grid with one line each: scannable, almost a table of contents.
- **Principles next,** set over atmosphere (the dark photograph), with numbers used as quiet
  structure.
- **Then two large doors** into the main offers, each a tall photograph with a thin uppercase title
  and an underlined link.

### Components and interaction

- **Buttons** have square corners and thin outlines at a quarter of the text colour, with tracked
  capital labels. They fill solid on hover. A primary and a secondary always come as a pair.
- **On phones, a fixed bottom bar** holds two equal buttons at least 48 px tall; under the hero,
  buttons stack at full width.
- **Effects:**
  - cards lift and images zoom slightly on hover, on desktop only;
  - a pressed state scales gently on touch.

---

## 4. What the two share

What reads as luxury in this category:

- **Restraint.** Few colours, a lot of open ground, one accent.
- **A serif carries the emotion; a quiet sans carries the information.**
- **Small capitals, tracked,** as wayfinding labels.
- **Hairlines instead of boxes and shadows.**
- **Large, warm photography,** cropped to portrait on phones.
- **Slow, subtle motion.** Nothing bounces.
- **On phones,** one column with the image first, and a persistent action at the bottom of the
  screen.

## 5. Why a guest invitation is different

Both references are **marketing sites for planners**. They persuade a stranger: many sections,
proof, testimonials, a form to start a conversation.

The Aveline guest page is a **personal invitation**:

- one guest, addressed by name;
- one job: understand who, what, when and where, then reply;
- its content comes from the API, in any of three scripts, and its length varies with what the
  host wrote;
- it is private. The link is a credential, so there are no third-party embeds and no tracking.

So the invitation needs fewer sections, a single primary action, and typography that holds up in
Armenian, Russian and English. Persuasion devices such as testimonials, trust badges, FAQs and
navigation menus have no place on it.

The patterns in §2 and §3 for presenting services will matter for a future Aveline marketing
page. They are not used on the invitation.

## 6. Adopt, adapt, avoid

| Pattern seen | Decision | How it is used in Aveline |
|---|---|---|
| Light warm ground with dark bands for rhythm | **Adapt** | An ivory ground with **burgundy** bands (the cover, the reply section, the footer) instead of brown or black. Burgundy is what makes the page Aveline's |
| Serif display with a quiet sans | **Adopt** | Already the designer's decision: Noto Serif and Noto Sans |
| Tracked capital micro-labels | **Adopt, with care** | Noto Sans capitals. Tracking is tighter for Armenian, pending a native reader's review |
| Italic accent words in headlines | **Avoid** | Armenian has no italic, so emphasis cannot depend on it in any language |
| Ultra-thin display capitals | **Avoid** | Thin strokes break at small sizes, and the brand typeface is Noto. The logo already carries the flared display voice |
| Huge, very tight headlines | **Adapt** | Large but readable; Armenian descenders need more leading |
| Gold numerals and hairline rules | **Adopt** | On light grounds gold is ornament only (2.2:1). It is text only on burgundy (6.55:1) |
| Inset hairline frame on photographs | **Adapt** | The Aveline frame is an **arch**, with a thin gold line around it |
| Monogram seal | **Adapt, with care** | Only from the hosts' own SIGNATURE block. Initials are never generated from names, because the API gives one host label, not two names |
| Pill buttons | **Avoid** | They read as generic software. Square corners read as couture |
| Square buttons with tracked labels | **Adopt** | Noto Sans labels; a filled primary, and outlined only for secondary actions |
| Blurred glass panels over photographs | **Avoid** | They read poorly on busy host photographs and cost performance on low-end phones |
| Dark gradients for text over photographs | **Adapt** | Only for the full-bleed cover variant, with contrast checked on the darkest and lightest photographs |
| Sticky bottom action on phones | **Adopt** | One "Reply" button, clear of the safe area, hidden once the reply section is on screen |
| Full-screen menus, testimonials, badges, FAQs | **Avoid** | The invitation has nothing to navigate and nothing to sell |
| Sections that fade up on scroll | **Adapt** | Content always starts visible. A short fade from a visible state, and none under reduced motion |
| Editorial documentary photography | **Adopt as the direction** | Hosts upload their own photographs. The mockups use registered placeholders |

## 7. What is not used

- None of the references' text, code, colour values, fonts, logos or images is in this
  repository.
- Their photographs appear only as placeholders on the private design canvas. They are listed in
  [PLACEHOLDER_IMAGES.md](PLACEHOLDER_IMAGES.md) and are replaced before launch.
- One reference uses a commercial display font. It is not used, and it is not named here.
