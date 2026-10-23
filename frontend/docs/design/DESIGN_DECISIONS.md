# Design decisions

> **Status: register, kept current.** Written on 13 October 2026. Updated on 18 October 2026:
> contract facts C-21 and C-22, assumption AS-12, five new questions, a correction to BQ-7, and the
> provisional defaults in §6, so that work can continue while the designer, product and the
> backend developer cannot answer.
>
> Every design statement in this folder falls into one of the kinds below. They are kept apart
> here so that nobody mistakes a recommendation or a working default for a decision.

## 1. How to read this file

| Prefix | Kind | Who can change it |
|---|---|---|
| **C-** | **Confirmed.** Decided by the designer, the frontend lead or the API contract | Whoever decided it |
| **R-** | **Recommendation.** Proposed in this design work, with a reason | Becomes C- when accepted |
| **AS-** | **Assumption.** Taken so work could proceed; may be wrong | Removed when verified |
| **DQ-, PQ-, BQ-** | **Open question,** for the **designer**, **product and the frontend lead**, or the **backend team** | Closed by the answer |
| **PD-** | **Provisional default:** what work builds on while a question is open (§6). Chosen to be cheap to reverse. Never a decision | Closed when its question is answered |
| **VR-** | **Review finding,** in [DESIGN_REVIEW.md](DESIGN_REVIEW.md) | Closed when fixed |

- **When a recommendation is accepted,** move it to §2 with the date and who decided, and update
  the document that specifies it.
- **When an answer changes a design,** update [GUEST_INVITATION.md](GUEST_INVITATION.md) or
  [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), and the artifact, in the same change.

The prefixes are deliberately different from `A1–A12` in the setup proposal, `B…`, `F…` and `D…`
in `docs/BACKLOG.md`, and `FR-…` in the setup proposal.

### 1.1 While questions are open

The designer, product and the backend developer could not answer as of 18 October 2026. Work
continues under these rules:

1. **Confirmed decisions bind.** Nothing provisional may contradict a C- item. Where a sample, a
   mockup or an artifact contradicts one, the C- item wins and the artifact is wrong. VR-02 is
   the example.
2. **Silence is not approval.** A recommendation stays an R- until its owner accepts it. Work
   builds on it only through a PD- that names it.
3. **Every default is cheap to reverse.** It lives in one token, one string, one configuration
   value or one component, and its row in §6 says what changes if the answer differs.
4. **The written specs govern the artifacts.** Where [GUEST_INVITATION.md](GUEST_INVITATION.md)
   or [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) and a mockup disagree, the spec wins and the
   difference is a finding in [DESIGN_REVIEW.md](DESIGN_REVIEW.md). Where a PD departs from a
   spec line, the PD says so, and the spec line carries a ⚠ marker.
5. **No invented features** (C-9) and **no permanent workaround for a backend gap** (root
   `CLAUDE.md` §2). A temporary stand-in is allowed only when a BQ- records the need and the PD
   names its exit.
6. **Launch gates stay gates.** A default can carry development and review; it cannot carry a
   real guest. The gates are in [README.md §6](README.md#6-launch-gates).
7. **When an answer arrives,** record it in §2 with the date and who decided, mark the PD row
   "Closed", follow its "If the answer differs" column, and update the spec and the artifact in
   the same change.

---

## 2. Confirmed

### From the designer, 12 October 2026

The details are in [BRAND_BRIEF.md](BRAND_BRIEF.md).

| ID | Decision |
|---|---|
| C-1 | Brand name **AVELINE EVENTS**, tagline **"Your Dream Event Planner."** |
| C-2 | Elegant, timeless, sophisticated. Inspired by European luxury houses such as Dior and Cartier. Classic serif typography with a modern, minimalist approach. Premium and refined, never flashy, overly decorative or generic |
| C-3 | The supplied PNG is the logo. It is preserved and never redesigned or replaced |
| C-4 | Colours: primary `#4F002B`, accent `#C5A477`, additional accent `#B8A38E`, exactly |
| C-5 | Armenian, Russian and English, fully supported |
| C-6 | Headings in Noto Serif Armenian / Noto Serif; body text in Noto Sans Armenian / Noto Sans. Typography, hierarchy, weights, spacing and readability are consistent across the three languages |

### From the frontend lead

| ID | Decision | When |
|---|---|---|
| C-7 | The guest invitation is designed first, with a reusable design system. The organizer dashboard comes later. This matches A12 in [the setup proposal](../FRONTEND_SETUP_PROPOSAL.md#a12--design-first-or-features-first) | 12 October 2026 |
| C-8 | Mobile first. The phone layout is designed on purpose, never a squeezed desktop | 12 October 2026 |
| C-9 | No invented product features or backend capabilities. Every piece of sample content is marked as sample | 12 October 2026 |
| C-10 | Photographs from the reference sites may stand in as **placeholders** in the mockups. Each is registered in [PLACEHOLDER_IMAGES.md](PLACEHOLDER_IMAGES.md) and replaced with Aveline-owned images during development or before launch | 12 October 2026 |
| C-11 | The reference analysis is committed at the level of patterns, with nothing copied | 12 October 2026 |
| C-12 | Aveline appears on the guest page **once, as a discreet footer mark** | 12 October 2026 |
| C-13 | The designs are built directly as Claude Design artifacts. No separate design prompt is written | 12 October 2026 |
| C-14 | **Stack:** public pages are rendered on the server with React Router 8; the app uses Tailwind 4 and shadcn/ui; the invitation has a separate renderer driven by tokens and variants; translations use i18next. See setup proposal A1, A2 and §5.8 | 9 October 2026 |

### From the contract

Sources: `docs/API.md` and the backend source at `9c94415`.

| ID | Rule the design must keep |
|---|---|
| C-15 | There are 14 block types. Blocks render **in the order received**; an unknown type renders nothing; a `null` or unknown variant means the template's default |
| C-16 | Render the `locale` the response names. Format times in the **event's time zone** |
| C-17 | **One link answers for the household.** Each person is ATTENDING, DECLINED or UNDECIDED. Names added to the party are limited by `seatsAllotted`. A choice is sent as the option's **position**. A required custom question binds only guests who attend. A closed invitation stays readable (`isAcceptingResponses: false`) |
| C-18 | **Capability links are secrets:** not logged, not tracked, never in a screenshot with the token. Invitation pages are `noindex`. A link preview never names a guest (setup proposal §5.2) |
| C-19 | The cover is the **first photo of the HERO block**. The music is the **MUSIC block's audio**, with an explicit on/off control (PRODUCT_SPEC §5.1) |
| C-20 | **Templates are data:** `allowedFonts`, `palettes`, `supportedBlocks` and `defaultTheme`. Hosts choose within them and never edit layout |
| C-21 | **Closing stops every write.** A first answer and a change to an existing answer go through the same request (`POST /api/v1/invitations/:slug/g/:guestToken/rsvp`), which refuses both once the invitation is closed or past `expiresAt`. A closed invitation stays readable. Verified in `rsvp.service.ts` and `invitations.service.ts` on 18 October 2026 |
| C-22 | **`expiresAt` is a retention limit, not a reply-by date.** The retention sweep sets it from the plan's `invitationLifetimeDays`; past it, the invitation page itself returns `404` ("no longer available"). Null means indefinitely. Verified in the same files and `schema.prisma` on 18 October 2026 |

---

## 3. Recommendations

Status: **proposed**, until accepted.

### Visual identity

| ID | Recommendation | Why | Specified in |
|---|---|---|---|
| R-1 | An **ivory ground**. **Burgundy** for display type, the cover, the primary action and dark bands. **Gold and taupe** only as ornament on light grounds; they can be text on burgundy | The brand colours, constrained by verified contrast: the accents reach only 2.2–2.4:1 on light | [DESIGN_SYSTEM §2](DESIGN_SYSTEM.md#2-colour) |
| R-2 | **Neutrals and derived colours:** ivory, porcelain, linen, ink, muted text, gold text, taupe text, field border, error, success, and hover and pressed burgundy | The brief gives three colours; a page needs text, surfaces and states. Each one is checked for contrast | [DESIGN_SYSTEM §2](DESIGN_SYSTEM.md#2-colour) |
| R-3 | Use the logo's blush `#FFEBF6` for **headings on burgundy** | It ties the cover's type to the logo, at 13.5:1. Depends on DQ-2 | [DESIGN_SYSTEM §2](DESIGN_SYSTEM.md#2-colour) |
| R-4 | **Square corners** (0–2 px) on buttons, cards, fields and images | Reads as couture and editorial, and differs from the pill shapes common in the category | [DESIGN_SYSTEM §5](DESIGN_SYSTEM.md#5-shape-lines-and-elevation) |
| R-5 | **The arch** as the one signature shape: the cover photograph's frame, with a gold hairline set off it. Used sparingly | It echoes the portals of Armenian churches and the logo's curved strokes, and neither reference uses it. Needs DQ-7 | [DESIGN_SYSTEM §5](DESIGN_SYSTEM.md#5-shape-lines-and-elevation) |
| R-6 | **Ornament** is limited to hairline rules, a small lozenge and the arch. No drawn flourishes, florals, textures or gradients | The brief asks for "refined rather than flashy, overly decorative" | [DESIGN_SYSTEM §5](DESIGN_SYSTEM.md#5-shape-lines-and-elevation) |
| R-7 | **Photography direction:** editorial and documentary, natural light, warm but true colour; 4:5 portraits on phones. Host photographs are shown as uploaded, with no filters | Matches the category's luxury cues without changing the host's photographs | [DESIGN_SYSTEM §6](DESIGN_SYSTEM.md#6-imagery) |

### Typography

| ID | Recommendation | Why | Specified in |
|---|---|---|---|
| R-8 | **Weights:** display in Noto Serif at 300–400, headings at 400–500, body in Noto Sans 400. Labels in Noto Sans 500 capitals at 12–13 px | Light display weights give the refined voice the brief asks for; body stays sturdy for reading on phones | [DESIGN_SYSTEM §3](DESIGN_SYSTEM.md#3-typography) |
| R-9 | Compose each role from two families with `unicode-range`: **Armenian from the Armenian family; Latin, Cyrillic, digits and punctuation from Noto Serif or Noto Sans** | Correct coverage (the Armenian families lack Cyrillic, `№`, `₽` and U+202F), the same Latin design (verified identical) and smaller downloads | [DESIGN_SYSTEM §3](DESIGN_SYSTEM.md#3-typography) |
| R-10 | **No meaning carried by italic, and no small capitals;** `font-synthesis: none` | Armenian has neither, so a browser would fake them | [DESIGN_SYSTEM §3](DESIGN_SYSTEM.md#3-typography) |
| R-11 | **Armenian adjustments:** line height +0.05 to 0.1; tracking on capitals at most 0.08 em, against 0.14–0.16 em for Latin and Cyrillic | Armenian lowercase is shorter (492–502 against 536) and descends deeper. Needs DQ-9 | [DESIGN_SYSTEM §3](DESIGN_SYSTEM.md#3-typography) |
| R-12 | Capitals are for **short labels only**, never sentences | Readability in all three scripts | [DESIGN_SYSTEM §3](DESIGN_SYSTEM.md#3-typography) |

### The guest invitation

| ID | Recommendation | Why | Specified in |
|---|---|---|---|
| R-13 | **The "Maison" concept:** the invitation read like a folded card, cover first and then the letter. From 1024 px wide, the cover stays pinned on the left while the letter scrolls on the right | It gives the page one memorable idea that works at every width | [GUEST_INVITATION §2](GUEST_INVITATION.md#2-the-concept-maison) |
| R-14 | A **sticky reply bar** on phones and tablets. It shows only while replies are open and the reply section is off screen, and it clears the safe area | Both references keep the main action within reach on phones; the guest's main task is to reply | [GUEST_INVITATION §4](GUEST_INVITATION.md#4-page-anatomy) |
| R-15 | **Replying happens inline in the page, with progressive disclosure:** choose first, then the details appear; one submit | A modal on phones scrolls badly, and a short first step lowers the effort to reply | [GUEST_INVITATION §6](GUEST_INVITATION.md#6-replying-rsvp) |
| R-16 | The invitation **keeps its own palette whatever the device's dark mode**, and declares `color-scheme: light` | It is a designed object; forced darkening breaks it | [DESIGN_SYSTEM §2](DESIGN_SYSTEM.md#2-colour) |
| R-17 | The **language switcher** appears only where switching works: on a generic link with more than one language now, and on personalised links once F16 lands | Today a personalised link ignores `?locale` | [GUEST_INVITATION §9](GUEST_INVITATION.md#9-languages) |
| R-18 | **No share button** on a personalised page | The link is the guest's credential; whoever holds it can answer for the household | [GUEST_INVITATION §12](GUEST_INVITATION.md#12-privacy) |
| R-19 | **Maps are links** (`mapUrl`), opening in a new tab with no referrer. No embedded maps | Content-security policy and privacy (setup proposal §5.11); there are no coordinates yet (F9) | [GUEST_INVITATION §5](GUEST_INVITATION.md#5-blocks) |
| R-20 | **Music** never plays on its own. One labelled control, off at first | Browsers block autoplay, and PRODUCT_SPEC asks for an explicit control | [GUEST_INVITATION §10](GUEST_INVITATION.md#10-motion-and-sound) |
| R-21 | The **countdown** renders after hydration, does not announce itself to screen readers, and the date stays readable as plain text | It is time-dependent (setup proposal §5.2), and a ticking announcement is noise | [GUEST_INVITATION §5](GUEST_INVITATION.md#5-blocks) |
| R-22 | Times carry a **time-zone label** such as "Yerevan time" | Diaspora guests are a primary segment (PRODUCT_SPEC §10) | [GUEST_INVITATION §9](GUEST_INVITATION.md#9-languages) |
| R-23 | The **footer** shows the logo file on a burgundy band, cropped with CSS. No words | Implements C-12. Needs no translation, and its background is the logo's own | [GUEST_INVITATION §4](GUEST_INVITATION.md#4-page-anatomy) |
| R-24 | **English dates** written day, month, year with a 24-hour clock | Matches the European positioning and the Armenian and Russian conventions. Needs PQ-4 | [GUEST_INVITATION §9](GUEST_INVITATION.md#9-languages) |
| R-25 | **Russian copy avoids gendered greetings** ("Дорогой" or "Дорогая"); it uses the name plus a neutral sentence | The API holds no gender | [GUEST_INVITATION §9](GUEST_INVITATION.md#9-languages) |
| R-26 | Counts are written **"Label: N"** where possible, otherwise with ICU plural rules | Russian has four plural categories; the label form avoids agreement errors | [GUEST_INVITATION §9](GUEST_INVITATION.md#9-languages) |

### Template data, for the backend to adopt later

| ID | Recommendation | Why | Specified in |
|---|---|---|---|
| R-27 | A template **"Maison"** (key `maison`). `allowedFonts` is `["Noto Serif Armenian", "Noto Sans Armenian"]`; `defaultTheme` is `{ "headingFont": "Noto Serif Armenian", "bodyFont": "Noto Sans Armenian", "palette": "bordeaux" }`. The renderer's font registry maps each name to its full stack | Templates are data (C-20). The brand fonts are guaranteed for Armenian, and the stack covers Russian | [DESIGN_SYSTEM §3](DESIGN_SYSTEM.md#3-typography) |
| R-28 | Two palettes, **"bordeaux"** (default) and **"champagne"**, with **named colour roles** | The renderer needs roles; today a palette is an unlabelled list. Needs BQ-1 and BQ-2 | [DESIGN_SYSTEM §2](DESIGN_SYSTEM.md#2-colour) |
| R-29 | **Variant names** for each block, declared in the template | `variant` is free text today (B46, F28) | [GUEST_INVITATION §5](GUEST_INVITATION.md#5-blocks) |
| R-30 | **Content fields** for each block, such as HERO `kicker`, `title`, `subtitle` | The backend stores free JSON per language; the editor and the renderer must agree on names | [GUEST_INVITATION §5](GUEST_INVITATION.md#5-blocks) |

### Product options, not part of the core concept

| ID | Option | Why it is only an option |
|---|---|---|
| R-31 | **Add to calendar:** an `.ics` file built in the browser from the event's times and venues | Not in PRODUCT_SPEC. It needs no backend, but it is still a new feature (PQ-5) |
| R-32 | **The guest's own local time,** shown beside the event time | Helps diaspora guests, but it is a new behaviour (PQ-6) |
| R-33 | A **full-screen photo viewer** for the gallery | A small interaction; useful, not essential |

---

## 4. Assumptions

| ID | Assumption | Checked by |
|---|---|---|
| AS-1 | `#FFEBF6` in the logo is intentional | DQ-2 |
| AS-2 | The brand name stays in **Latin letters** in every language, as in the logo | The designer |
| AS-3 | The tagline does not appear on the guest invitation; it exists in English only | DQ-5 |
| AS-4 | The first template uses the brand palette by default; hosts may pick the template's other palette | The frontend lead |
| AS-5 | Hosts supply their own photographs. Aveline offers no image library | Product |
| AS-6 | **Sample content:** the demo couple "Anna & Davit" from `backend/prisma/seed.ts`, the guest Armen Petrosyan and the Petrosyan family with 3 seats. Venue names, addresses, notes and the phone number are fictional | n/a |
| AS-7 | The dietary and drink options in the mockups are samples | PQ-1, PQ-2 |
| AS-8 | The mockups show every well-known RSVP question. Which ones a given invitation asks is still open | PQ-3, BQ-4 |
| AS-9 | The Armenian and Russian strings are drafts and need a native reader | DQ-9 |
| AS-10 | Most guests open the link on a phone, from a messaging app (PRODUCT_SPEC §12) | Pilot analytics are off by design; ask hosts |
| AS-11 | The narrowest supported screen is 320 CSS px. The designs are drawn at 360, 390, 768 and 1440 | The browser matrix (setup proposal §15 Q4) |
| AS-12 | The artifact versions dated 18 October 2026 (canvas `1792311698-0d0b`, design system `1792311699-2b48`) are automatic saves with no design change. `tokens.json` is unchanged, every review finding was re-verified against them, and the gallery shows both as last updated on 12 October. The 13 October source files were no longer on disk to compare byte for byte | Compare against these versions before the next design change ([DESIGN_REVIEW §3](DESIGN_REVIEW.md#3-what-was-checked)) |

---

## 5. Unresolved questions

**Every question here has a working default in [§6](#6-provisional-defaults),** so none of them
blocks development. Some block launch ([README §6](README.md#6-launch-gates)).

### For the designer

| ID | Question | Blocks |
|---|---|---|
| DQ-1 | Please supply the logo master as vector (SVG or PDF) and a transparent PNG, and confirm the clear space (one `AVELINE` cap height) and the minimum sizes (140 px on screen, 35 mm in print) | Using the logo anywhere but on burgundy |
| DQ-2 | Is the blush `#FFEBF6` in the logo intentional? Is it a brand colour? The concept uses it for headings on burgundy | R-3 |
| DQ-3 | Which colourways are approved: on light grounds, and single colour? | The logo on ivory, in print, on documents |
| DQ-4 | Is there a small mark or monogram for favicons, app icons and avatars? | The app shell, the browser tab |
| DQ-5 | Is the tagline translated into Armenian and Russian, or always shown in English? | AS-3 |
| DQ-6 | Please approve or correct the recommended neutrals and derived colours | R-2 |
| DQ-7 | Please approve the arch, the ornament vocabulary and the photography direction | R-5, R-6, R-7 |
| DQ-8 | Is the logo's display typeface a known font? Only to avoid lookalikes; the logo is never set in it | n/a |
| DQ-9 | Can a native reader review Armenian capitals with tracking, and every Armenian and Russian string? | R-11, AS-9 |
| DQ-10 | Please approve or change **square corners** (R-4), **capitals for labels and buttons** (R-8, R-12) and the concept's working name, **"Maison"** (R-13, R-27). *Added 18 October 2026* | The visual language; the template's name |
| DQ-11 | Is a **second palette, champagne,** wanted? *Added 18 October 2026* | R-28, the Cover-champagne board |
| DQ-12 | The review's design fixes (2, 3, 5–7, 9, 12–14, 17 and 21 in [DESIGN_REVIEW §5](DESIGN_REVIEW.md#5-fixes)): accept the directions in PD-14 and PD-27 to PD-37, or redraw? *Added 18 October 2026* | Those fixes |

### For product and the frontend lead

| ID | Question | Blocks |
|---|---|---|
| PQ-1 | Which **dietary options** do guests see? The API takes free strings, and the catering sheet counts whatever is sent, so the list must be fixed and translated | The RSVP form |
| PQ-2 | Which **drink options** do guests see? The API takes one free string of up to 80 characters | The RSVP form |
| PQ-3 | Which **well-known questions** does each invitation ask (side, dietary, drink, song, message), and does the host choose them? | The RSVP form, BQ-4 |
| PQ-4 | **English date and time format:** day-month-year with a 24-hour clock (R-24), or US style? | Formatting |
| PQ-5 | Offer **add to calendar** (R-31)? | n/a |
| PQ-6 | Show the **guest's local time** (R-32)? | n/a |
| PQ-7 | Who supplies the replacement **photography**, and when? | Launch (C-10) |
| PQ-8 | Should the footer mark **link to an Aveline website**? Capability pages strip the referrer, so a link is safe | The footer |
| PQ-9 | May the contact block name **Aveline** when Aveline itself organises the event? C-12 allows one appearance, the footer mark, and the sample content names Aveline as organiser (VR-02). *Added 18 October 2026* | The contact block |

### For the backend team

These are candidates for `frontend/docs/BACKEND_REQUESTS.md` once that file exists (setup proposal
§3.6).

| ID | Question | Why it matters |
|---|---|---|
| BQ-1 | **The guest payload carries the palette's name, never its colours** (`theme.palette`). Can the payload include the resolved colours or tokens? | Without it the renderer needs its own copy of every template's palettes, and "templates are data" stops being true. This is the same problem as FR-9 for fonts |
| BQ-2 | **Palette colours have no roles,** and the two seeded templates order them differently: classic is background, accent, text; minimal is background, text, muted. Can palettes name their roles (R-28)? | A renderer cannot tell which colour is the text |
| BQ-3 | A host's own `colors` (1 to 8 values) have the same problem | Host-tuned palettes cannot render |
| BQ-4 | Nothing says **which well-known RSVP questions** an invitation asks. Could RSVP block `settings` carry it? | PQ-3 |
| BQ-5 | A **required SIGNATURE question** cannot be answered, but required questions bind attending guests, so every attending guest would be refused. Can creating one be refused, or the requirement skipped? | Guests unable to reply |
| BQ-6 | API.md §6 says the public page leaves out `settings`, but the code returns each block's `settings`. The dress-code swatches need them. Which is right? | DRESS_CODE |
| BQ-7 | There is **no reply-by date** in the payload, only `isAcceptingResponses`. A "please reply by" line is free text today. Should `expiresAt` be exposed? **Corrected on 18 October 2026:** `expiresAt` is the retention limit (C-22), so exposing it would not give a reply-by date. The question is whether an invitation should have a separate, optional reply-by date, and whether replies should close on it by themselves. Closing is manual today | The RSVP block's copy; the closed state |
| BQ-8 | The development and production seeds name theme and palette fields differently (`font` and palette `key`, against `bodyFont` and palette `name`), and theme validation reads `name` | The renderer's theme parsing |
| BQ-9 | If product chooses fixed dietary and drink options (PQ-1, PQ-2), can each invitation define its own, as custom questions do? Today `dietary[]` and `drinkPreference` are free strings with no option list. *Added 18 October 2026* | The RSVP form; the catering sheet |
| BQ-10 | Could dress-code colours carry optional names in each language, so that screen readers can say them (VR-35)? Low priority. *Added 18 October 2026* | DRESS_CODE |

### From the review page

The [review page](https://claude.ai/artifact/XGY21GRtMK6JFueWda51YM) of 13 October numbered its
questions Q1–Q11. They map to this register:

| Review | Register | Review | Register |
|---|---|---|---|
| Q1 blush | DQ-2 | Q7 options per event | BQ-9 |
| Q2 derived colours | DQ-6 | Q8 palette colours | BQ-1, BQ-2 |
| Q3 corners, capitals, "Maison" | DQ-10 | Q9 reply-by date | BQ-7 |
| Q4 champagne | DQ-11 | Q10 does closing block changes? | **Answered by the code: C-21** |
| Q5 Aveline in the contact block | PQ-9 | Q11 colour names | BQ-10 |
| Q6 fixed options or free text | PQ-1, PQ-2 | | |

**Existing backlog items the design depends on:**

| Item | What the design waits for |
|---|---|
| F16 | Switching language on a personalised link; translatable host and venue names |
| B33 | Matching a timeline entry to its venue |
| B16 / D4 | Find your seat through the guest's link |
| F9 | Venue coordinates |
| F11 | Alt text on uploads |
| F18 | Image resizing |
| F28 | Variants declared in the template |
| FR-9 | How template fonts reach the browser |
| B49 | A private invitation readable through its generic URL |

---

## 6. Provisional defaults

Status: **working defaults, not decisions.** Written on 18 October 2026, when none of the owners
could answer. Each row names the open item it stands in for, what to build on meanwhile, and what
changes if the answer differs. The rules are in [§1.1](#11-while-questions-are-open).

**In code since 22 October 2026** (`frontend/src/`), each named in a comment where it applies:

| Defaults | Where |
|---|---|
| PD-1, PD-2, PD-19 | The footer mark and the favicon: `features/invitation-renderer/components/footer-mark.tsx`, `public/favicon.svg` |
| PD-9 | Every Armenian and Russian string in `locales/`, and the Armenian date words in `lib/time` |
| PD-10, PD-12 | `styles/app.css` (Armenian tracking) and the cover's date line (Russian in sentence case) |
| PD-11 | `lib/time`: day, month, year; a 24-hour clock |
| PD-15, PD-16 | `features/guest-reply/options.ts`: the sample lists, English keys, one switch per question |
| PD-21, PD-22 | `features/invitation-renderer/theme.ts`: bordeaux only, `theme.palette` only |
| PD-23 | SIGNATURE questions are never shown (`guest-reply/form-model.ts`) |
| PD-24, PD-26 | `schemas.ts` reads six-digit hex from `settings.palette`; the swatches are one labelled image |
| PD-25 | No deadline is computed; `isAcceptingResponses` alone decides |
| PD-27, PD-31 | The reply bar (`components/reply-bar.tsx`) and the cover's Reply on desktop |
| PD-28, PD-32, PD-33 | `ui/form/`: three stacked choice cards, segmented member controls, radio cards for drink |
| PD-29 | Names are unbreakable spans on the personal card and in the reply confirmation |
| PD-35 | The countdown: days, hours, minutes; once a minute; after hydration |
| PD-36 | "Thank you" replaces the reply section's heading once sent |
| PD-37 | Undrawn states built from the spec; the open card checked at 1,024 px in a browser. The `full-bleed` cover falls back to the arch |

### Brand and visual system

| ID | Open item | Build on this meanwhile | If the answer differs |
|---|---|---|---|
| PD-1 | DQ-1, DQ-3: no vector, transparent or light-ground logo | The supplied PNG, unchanged, only on `#4F002B`, cropped with CSS as `FooterMark` does. Clear space of one `AVELINE` cap height; the lockup at least 140 px wide. No logo on ivory, photographs, print or icons | New files only add placements. Nothing already built changes |
| PD-2 | DQ-4: no small mark | Nothing is derived from the logo (C-3). Where a favicon is required, a plain `#4F002B` square | One file to replace |
| PD-3 | DQ-5: tagline translations | The tagline stays in English and never appears on the guest page (AS-3) | One string |
| PD-4 | DQ-2: is blush a brand colour? | `brand-blush` keeps its current roles and gains no new ones: display type, headings, the primary action and the focus ring on burgundy (the Bordeaux `heading`, `action` and `focus` tokens) | Point those three tokens at `ivory`, which keeps 12.51:1 or better on every Bordeaux surface. A token change; no component changes |
| PD-5 | DQ-6: the derived colours | The R-2 values exactly as in `tokens.json` (SHA-256 `713cbb7ca577b318…`), used only through semantic tokens. No raw hex in components | Change the token, then re-run the contrast checks in [DESIGN_SYSTEM §2](DESIGN_SYSTEM.md#2-colour) |
| PD-6 | DQ-7: the arch, ornament, photography | Kept as specified, with the arch confined to `ArchFrame` (the cover and the signature) | `ArchFrame` becomes a square 4:5 frame: one component |
| PD-7 | DQ-10: square corners, capitals, the name "Maison" | Corners only through the radius tokens. Capitals only through the `eyebrow` and `button-text` styles (`text-transform`), so every string is stored in sentence case. "Maison" is an internal working name, shown to no host or guest | A token, a style or a label each |
| PD-8 | DQ-11: a champagne palette | Not built. Only bordeaux is built; the Cover-champagne board stays an exploration | Nothing to undo |

### Language and copy

| ID | Open item | Build on this meanwhile | If the answer differs |
|---|---|---|---|
| PD-9 | DQ-9: Armenian and Russian copy | English is the source. Armenian and Russian strings, including any new ones, are drafts, marked for review wherever they are stored | Strings only. A native reading is a launch gate |
| PD-10 | DQ-9, VR-16: Armenian capitals | The design system's rule: labels and buttons in capitals by `text-transform`, tracked 0.08 em and 0.06 em. The canvas's sentence-case Armenian music label is the exception, and is treated as wrong | Drop `text-transform` under `:lang(hy)`: one rule |
| PD-11 | PQ-4: English date format | Day, month, year and a 24-hour clock (R-24), from one formatter | One setting |
| PD-12 | VR-17: Russian dates in capitals | Russian dates are not set in capitals; they stay in sentence case under `:lang(ru)` | One rule |
| PD-13 | VR-03, C-21: the line under Send reply and in the confirmation | "You can change your reply with this link while replies are open." Never "at any time". **Closed 18 October 2026:** fix 16 put this line in the spec and on both artifacts. It rests on C-21, a contract fact, so it no longer depends on an answer; only its Armenian and Russian drafts wait for a native reader (PD-9) | One string per language |
| PD-14 | VR-15, VR-28, VR-32, VR-33: copy where the spec and the artifacts differ | The spec's wording wins: the closed-state line, "Attending · 3 people" with plural rules, and the network error with its reference code. English uses typographic apostrophes (’). *18 October: the closed line and the apostrophes are applied on the artifacts (fixes 18, 19); the status unit and the reference code wait for the designer (fixes 17, 21)* | Strings only |

### Product

| ID | Open item | Build on this meanwhile | If the answer differs |
|---|---|---|---|
| PD-15 | PQ-1, PQ-2, BQ-9: dietary and drink options | The sample lists already drawn, in one configuration file with their translations: dietary, several allowed (vegetarian, vegan, gluten-free, lactose-free, nut allergy, and "Anything else we should know?"); drink, one (wine, champagne, spirits, non-alcoholic). Send the **same English key in every language**, so the catering sheet doesn't count one option under three names. Demos label them as samples | Edit one file. Free text replaces two controls with fields |
| PD-16 | PQ-3, BQ-4: which well-known questions an invitation asks | All of them, all optional: side (only when both side labels exist), dietary, drink, song, message. Each sits behind one renderer switch | Turn switches off, or read them from the RSVP block once BQ-4 is answered |
| PD-17 | PQ-5, PQ-6: add to calendar; the guest's local time | Neither is built. Times show the event's zone with its label (R-22) | Nothing to undo |
| PD-18 | PQ-7: replacement photography | Placeholders stay only on the private canvas. Code, fixtures and demos use no photographs: the typographic cover and plain `sand` blocks | Nothing to undo. Replacing the placeholders is a launch gate |
| PD-19 | PQ-8: a link on the footer mark | The footer mark is not a link | One attribute |
| PD-20 | PQ-9, VR-02: Aveline in the contact block | C-12 governs: Aveline appears once, as the footer mark. Sample organisers are fictional people. The "Aveline Events" sample on the canvas and in [GUEST_INVITATION §13](GUEST_INVITATION.md#13-sample-content) is treated as an error | If product allows the exception, amend C-12 in writing first |

### Backend

| ID | Open item | Build on this meanwhile | If the answer differs |
|---|---|---|---|
| PD-21 | BQ-1 to BQ-3: palette colours and roles | **A temporary stand-in:** one renderer module maps a palette name to named roles and holds only "bordeaux" (R-28). Any other name falls back to the template's default palette, and a host's own `colors` are ignored. Nothing else may be added to it. The demo event therefore renders in bordeaux, not in its seeded "ivory-gold" | Delete the module and read the colours from the payload once BQ-1 and BQ-2 are answered. It must not outlive them (rule 5) |
| PD-22 | BQ-8: theme field names differ between the seeds | Read only the shape `docs/API.md` documents. Anything missing falls back to the template's default theme | One parser |
| PD-23 | BQ-5: a required SIGNATURE question blocks attending guests | SIGNATURE questions are never shown (spec §6.1g). If the server refuses a reply because of one, the guest sees the validation-error state | The guard is backend work, and a launch gate |
| PD-24 | BQ-6: are block `settings` public? | Use `settings` when the response carries them, as the code does today. The swatches render only from valid hex values in `settings.palette`; otherwise the dress code is text only | Nothing to undo |
| PD-25 | BQ-7, C-22: no reply-by date | No deadline is shown except the host's own words in the RSVP block. Nothing is computed from `expiresAt`. `isAcceptingResponses` alone decides whether the form shows | Add a date line if a field arrives |
| PD-26 | BQ-10: names for swatch colours | The swatches stay unnamed, labelled "Suggested colours". The dress-code text carries the guidance | Add the names as labels |

### The review's design fixes

Directions for the designer-owned fixes in [DESIGN_REVIEW §5](DESIGN_REVIEW.md#5-fixes), until the
designer answers DQ-12. None is applied to the artifacts yet.

| ID | Finding and fix | Build on this meanwhile | If the answer differs |
|---|---|---|---|
| PD-27 | VR-29, fix 2: the answered reply bar wraps | Below 480 px the status sits above a full-width secondary "Change reply"; from 480 px they share one row | One component's layout |
| PD-28 | VR-07, VR-21, VR-36, fix 3: labels wrap inside answer controls | The three attendance cards stack vertically at every width, as on phones. In the per-person control a label may wrap to two centred lines, and the three segments share one height. Checked in Russian at 320 px | One component's layout |
| PD-29 | VR-01, fix 4: names split | A name, or "1 seat to name", never breaks inside; lines wrap only between items. *The mockups follow it since 18 October (fix 4); it stays the rule for code* | Nothing to undo |
| PD-30 | VR-05, fix 5: the first screen | The first screen shows the occasion, the hosts and the date, and the guest's name comes within one scroll (spec §1). The personal card either shows its greeting above the reply bar or starts below it; a lone label never peeks out | Cover spacing only |
| PD-31 | VR-04, fix 6: two Reply buttons | The reply bar also hides while the personal card's Reply is on screen, extending R-14. On desktop the cover's Reply becomes the reply status once the reply section is in view | One visibility rule |
| PD-32 | VR-09, fix 7: single choice looks like multiple choice | Single-choice options, drink included, use the ChoiceCard (radio) style; chips are for multiple choice only. This departs from spec §6.1e ("single-choice chips"), which carries a ⚠ marker | Swap one control back |
| PD-33 | VR-08, VR-12, VR-31, fixes 8 and 9: selected answers and card sizes | The design system's ChoiceCard governs: its own radio mark, a check on every selected card, and 56 px for every option card | One component |
| PD-34 | VR-23, fix 12: text over photographs | Small text over a photograph is ivory or blush only, on `burgundy-deep` (`#3A0020`) at 65% opacity or more where the text sits. That holds 4.5:1 even over a pure-white area. Gold and taupe text stay off photographs; they would need 83% or more | One scrim value |
| PD-35 | VR-34, fix 13: the countdown ticks every second | The `numerals` countdown shows days, hours and minutes, and updates once a minute. This departs from spec §5's seconds, which carry a ⚠ marker | Add the seconds unit back |
| PD-36 | VR-14, fix 14: the sent state | "Thank you" replaces "Kindly reply / Will you join us?" as the heading, with the confirmation sentence under it; focus moves to the heading (spec §6.2) | Heading text only |
| PD-37 | VR-18, VR-25, VR-26, fix 15: states and sizes not drawn | The undrawn states are built from the spec's words (§6.2, §7) with the existing components, and drawn later. Until a 1,024 px board exists, the open card is checked at 1,024 px in a browser | Adjust to the drawings when they arrive |

---

## 7. Out of scope

Not designed now, each for the reason given:

| Not designed | Why |
|---|---|
| The organizer dashboard and app screens | C-7. [DESIGN_SYSTEM §12](DESIGN_SYSTEM.md#12-from-invitation-to-dashboard) maps the tokens for later |
| Public event pages, ticketing, checkout | Not the first deliverable |
| Find your seat | B16 and D4 |
| Signature capture | Not built in the backend (INVITATION_DESIGN §7) |
| Email, Telegram and WhatsApp message designs | A separate surface; the backend owns the copy |
| Link-preview images | Invitation previews use `coverUrl` as it is. F24 concerns public events |
| An Aveline marketing site | Not requested |
