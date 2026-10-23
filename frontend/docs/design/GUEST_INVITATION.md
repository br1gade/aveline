# The guest invitation: "Maison"

> **Status: concept, proposed.** Written on 13 October 2026.
>
> Everything here is a **recommendation** unless it cites a confirmed item (C-) from
> [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md). The visual reference is the design canvas linked in
> [§14](#14-the-artboards). Tokens and components are in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
>
> The concept is drawn against the contract as it stands: `docs/API.md` §4 and the backend source
> at `9c94415`. Where the contract cannot support something, this file says so instead of
> designing around it.
>
> **Updated on 18 October 2026.** The 13 October review's findings are in
> [DESIGN_REVIEW.md](DESIGN_REVIEW.md). The frontend-owned fixes are applied here and on the
> canvas: the reply line (§6, §13), the closed wording, typographic apostrophes in the sample
> strings. The rest is unchanged. Lines marked **⚠** are known to be
> wrong or are departed from by a working default. Where a question is open, build on the
> provisional defaults in [DESIGN_DECISIONS §6](DESIGN_DECISIONS.md#6-provisional-defaults).

## 1. The guest's job

**Who:** a guest, usually the household's primary guest, who received a personal link by email,
Telegram or WhatsApp.

**How they arrive:** they open it on a phone, often inside the messaging app's own browser, often
within minutes of it being sent (PRODUCT_SPEC §12).

**What they need, in order:**

1. See that it is for them, and what it is: who, what and when. All on the first screen.
2. Learn where and when to be.
3. Reply for their household.
4. Come back later, through the same link, for the address, the time or the dress code.

**The design succeeds when:**

- **The first screen,** 390 × 844 with no scrolling, shows the occasion, the hosts and the date.
  The guest's own name appears within one scroll.
- **A household of three replies in under a minute,** without errors on the first try.
- **Every time** is in the event's time zone, and labelled with it.
- **All three languages** fit at 320 px wide, with no truncation.
- **WCAG 2.2 AA** holds throughout.
- **Everything readable arrives with the server's HTML.** Only the countdown and the interactive
  parts of the reply need JavaScript.

## 2. The concept: Maison

The invitation reads like a **folded couture card**:

- **The cover:** a burgundy field holding an arch-framed photograph, the hosts' names in a light
  serif, and the date.
- **The letter inside:** an ivory page where the details sit in one calm column.
- **The close:** a burgundy band where the guest replies, and below it the house mark.

**Why this concept:**

- **One idea, easy to remember.** Every width shows the same card: on a phone it unfolds downward;
  from 1024 px it opens like a card, with the cover pinned on the left and the letter on the
  right.
- **Burgundy carries the identity.** Gold on white is the category's default, and one reference's
  gold is practically the same as Aveline's accent ([REFERENCE_ANALYSIS.md](REFERENCE_ANALYSIS.md)).
- **The arch belongs to this brand.** It recalls the portals of Armenian churches and the curved
  strokes of the logo, and neither reference uses it.
- **Restraint.** One primary colour, one accent used as hairlines, one signature shape, generous
  space. That is how the brief's "premium and refined rather than flashy" reads on a phone.

The template name **"Maison"** is a proposal (R-27).

## 3. What the page is built from

Every element maps to a field the API returns. Nothing on the page comes from anywhere else.

| From the API | Where it appears | Notes |
|---|---|---|
| `event.type` | The cover's small label: "Wedding" | Translated from the enum in the interface strings: WEDDING, ENGAGEMENT, BAPTISM, BIRTHDAY, ANNIVERSARY, CORPORATE, OTHER |
| HERO `content.title`, or else `event.hosts` | The cover's display line: "Anna & Davit" | `title` is translated per language; `event.hosts` too, when the host translated it |
| `event.startsAt`, `endsAt`, `timezone` | The cover's date line, the countdown, the time-zone label | Formatted in `timezone` (C-16) |
| `coverUrl`, the HERO's first photo | The arch photograph | Without one, the cover is typographic |
| `guest.name` | The personal card's greeting | `guest` is `null` on the generic link, and then the card is left out |
| `guest.household`: name, seats allotted, members | The personal card ("Seats reserved: 3") and the reply form's household list | Members are listed primary guest first |
| `guest.rsvp`: status, responded at | The status chip on the personal card and in the reply bar | |
| `isAcceptingResponses` | Whether the reply form is offered | `false` gives the closed banner (C-17) |
| `locale`, `availableLocales` | `<html lang>`, the language of the interface, the switcher (R-17) | |
| `musicUrl` | The music control | No control when it is `null` |
| `blocks[]` | The sections of the letter, in the order given ([§5](#5-blocks)) | Never sorted. Unknown types render nothing (C-15) |
| `rsvpQuestions[]` | The host's own questions in the reply form | In the order given |
| `event.sides.a`, `event.sides.b` | The options for "Who invited you?" | Asked only when both labels exist and `rsvpFields` asks it |
| `rsvpFields` | Which built-in questions the reply form asks, and the host's own dietary and drink choices | Added by the backend on 23 October 2026 (BQ-4, BQ-9) |
| `theme` (`palette`, `headingFont`, `bodyFont`) | The tokens ([DESIGN_SYSTEM §2](DESIGN_SYSTEM.md#2-colour)) | Palette colours are not in the payload (BQ-1) |
| `template` | Which variant names apply ([§5](#5-blocks)) | Variants are free text until F28 |

**Available since the backend's changes of 23 October 2026, and used:** each timeline entry's venue
(B33), the language switcher on personal links (F16), alt text (F11), and smaller copies of each
photograph (F18).

**Available, but not designed yet, so not shown:**

- the guest's table, in `guest.seating`, once the host publishes the seating (B16 / D4);
- map coordinates (F9). The page keeps its links rather than an embedded map (R-19);
- a link to get reminders on Telegram, `guest.telegramLink`, which carries the guest's token
  (BQ-11).

**Not available, so not designed:** a reply-by date (BQ-7).

## 4. Page anatomy

From top to bottom, phone first:

1. **Top bar,** transparent over the cover.
   - **Left:** the language switcher, only when it works (R-17).
   - **Right:** the music control, only when `musicUrl` exists.
   - Both are 44 × 44 at least.
   - No logo here (C-12). The bar scrolls away with the cover. **Once music is playing,** a small
     pause button stays pinned top-right, inside the safe area, so the sound can always be
     stopped.
2. **The cover** (the HERO block). A burgundy field holding, in order:
   - the occasion in small gold capitals;
   - the **arch photograph**, with a thin gold line set 8 px outside it;
   - the hosts' names in light display serif, in blush;
   - a small ornament: hairline, lozenge, hairline;
   - the date and time in ivory capitals;
   - the time-zone label.
3. **The personal card,** on personalised links only. A porcelain card with a hairline border,
   overlapping the bottom of the cover by 32 px, like a card tucked into a folder. It holds:
   - a small label, "Your invitation";
   - the greeting with the guest's name;
   - one sentence of welcome;
   - "Seats reserved: 3", and the names in the household;
   - the reply status chip, if they have replied;
   - a **Reply** button, which scrolls to the reply section and moves focus to its heading.
4. **The letter:** the blocks in the host's order ([§5](#5-blocks)). Each section has:
   - a small label and a heading;
   - its content;
   - 64–96 px of space above it.

   The ornament divider is used once or twice on a page, not between every pair of sections.
5. **The reply section** (the RSVP block, wherever the host placed it). A burgundy band with the
   heading in blush, and the form on a **porcelain card** set into the band ([§6](#6-replying-rsvp)).
   The form stays on a light surface because the error and success colours pass only there.
6. **The footer:** a burgundy band holding the logo file, cropped with CSS to the lockup and its
   clear space (C-12, R-23). No words, so nothing needs translating.
7. **The sticky reply bar,** on phones and tablets.
   - **Shows only when** replies are open, the link is personal, and the reply section is off
     screen (R-14).
   - **Not yet answered:** one full-width **Reply** button.
   - **Answered:** the status chip and a **Change reply** button.
   - It sits on porcelain with a hairline above it and clears the safe area. The page reserves its
     height with `scroll-padding-bottom`, so it never hides a focused field.

**The generic link** (no guest token) shows the same page without the personal card or the reply
bar. Its reply section shows one line: "To reply, open the personal link you received". Replying
needs the guest's token. **It opens only for an `UNLISTED` or `PUBLIC` event:** a `PRIVATE` one,
every wedding by default, is reached by personal link only, and its generic link shows the
not-found page (docs/API.md §4).

## 5. Blocks

Fourteen types (C-15). For each:

- **Content fields** that are *seeded* exist in `backend/prisma/seed.ts`. The others are
  **proposals** (R-30): the backend stores block content as free JSON per language, so the editor
  and the renderer must agree on the names.
- **Variants are proposals** (R-29). The first one listed is the default, used for `variant: null`
  or any unknown name.

### HERO: the cover

- **Content:** `title` (seeded) for the display line. Proposed: `subtitle`, one line under the
  names, such as "invite you to celebrate their wedding".
- **Data:** `event.type`, `startsAt`, `timezone`. Media: the first photo is the cover (C-19).
- **Variants:**
  - **`arch`:** a burgundy field with the photograph in an arch.
  - **`full-bleed`:** the photograph fills the first screen. A dark gradient rises from the
    bottom, and the names sit on it, checked for contrast on the photograph's lightest point.
  - **`typographic`:** used automatically, whatever the variant, when there is no photograph.
    Large names, the ornament and the date on burgundy.
- **From 1024 px:** the cover becomes the pinned left panel, if HERO is the first block. If it is
  not, it renders in place as a wide band.
- **Edge cases:**
  - Long names wrap with `text-wrap: balance`, and the type steps down until they fit in three
    lines.
  - Names in another script than the interface are expected, where the host has not translated them.

### STORY: the invitation text

- **Content:** `body` (seeded), plain paragraphs. Proposed: `title`. Media: optional photographs.
- **Variants:**
  - **`letter`:** a centred column of at most 34 em; the first paragraph one size larger.
  - **`with-photo`:** the photograph above the text on phones, beside it from 1024 px.
- **Empty:** a STORY with no text renders nothing.

### COUNTDOWN

- **Data:** `{ target, timezone }`. Proposed content: `title`.
- **Variants:**
  - **`numerals`:** days, hours, minutes and seconds in light serif digits, with small labels
    under them. **⚠** Seconds risk WCAG 2.2.2 (VR-34); PD-35 drops them.
  - **`days`:** one line, "42 days to go".
- **Behaviour (R-21):**
  - It renders after hydration; the server's HTML shows only the date.
  - It is not announced to screen readers, and is hidden once the target has passed.
  - Digits are tabular by default, so nothing shifts as they change.

### MUSIC

- **Media:** one audio file (C-19).
- **Variants:**
  - **default:** renders nothing in the letter; the control lives in the top bar (§4).
  - **`card`:** a small card with a play button and a proposed `title`, such as "Our song".
- Never plays on its own (R-20).

### VENUE

- **Data:** each venue's role, name, address, latitude, longitude, `mapUrl` and `arriveAt`.
- **Variants:**
  - **`cards`:** one card per venue: the role as a small label, the venue's name as a serif
    heading, the address as selectable text, then "Arrive by 13:45" in the event's zone. Actions:
    **Get directions** (only when `mapUrl` exists) and **Copy address**.
  - **`list`:** the same facts in a compact list.
- **Layout:**
  - Phones stack the cards. Tablets show two side by side.
  - The desktop letter column shows two side by side when there are two venues, otherwise one.
- **Role labels** are interface strings: CEREMONY, RECEPTION, AFTER_PARTY, PREPARATION, OTHER.
  Venue names and addresses come in the page's language when the host translated them.

### MAP: directions

- **Data:** the same venues.
- **Variant `links`:** "How to get there", with one row per venue: the role, the name, and
  **Open in Maps**.
- **No embedded map** (R-19). Links open in a new tab with `rel="noreferrer noopener"`.
- **Hidden** when no venue has a `mapUrl`: the venue cards already show the addresses.

### TIMELINE: the running order

- **Data:** each entry's `label`, `occursAt` and `venueId`.
- **Variants:**
  - **`vertical`:** the time in serif tabular numerals on the left and the label on the right,
    along a thin gold line with a small lozenge at each entry.
  - **`compact`:** a two-column list.
- **The venue** of an entry is named in small text under its label, when the page shows that venue.
- Entries spanning more than one day get a date heading for each day.

### DRESS_CODE

- **Content:** `body` (seeded). Proposed: `title`. Settings: `palette`, a list of hex colours
  (seeded).
- **Variant `swatches`:** the text, then a row of **square fabric-sample swatches**, 36 px with a
  hairline edge so pale colours still show on ivory.
- **The swatches are decoration** (`role="img"`, labelled "Suggested colours"). The text carries
  the actual guidance, because hex values cannot be named in words.

### NOTES: the host's requests

- **Content (proposed):** `title`, and `items`, a list of `{ title, body }`. Examples: flowers,
  photographs, children.
- **Variants:** **`list`** (items separated by hairlines) and **`cards`**.

### GALLERY

- **Media:** photographs, in order.
- **Variants:**
  - **`editorial`:** on phones, two columns where every third photograph spans the full width; on
    desktop, a mosaic.
  - **`grid`:** even squares, 2, 3 or 4 columns.
  - **`carousel`:** horizontal scrolling that snaps, on phones.
- **Alt text:** `altText`, or empty when the host gave none.
- **Weight:** images load lazily, with a `srcset` from the smaller copies the backend makes after
  upload, and `sizes`. Until the copies exist, the original is served.

### RSVP

See [§6](#6-replying-rsvp).

### SIGNATURE

- **Media:** the hosts' signature or monogram image.
- **Proposed content:** `closing`, a line such as "With love,".
- **Variant `centered`:** the closing line, then the signature, at most 240 px wide. A transparent
  PNG is advised, so no box shows.

### CHAT

- **Proposed content:** `title`, `body`, `url` (the group chat link) and `label`.
- **Variant `button`:** one or two lines, then an outlined button, "Join the guest chat", opening
  in a new tab.

### CONTACT

- **Content:** `organizer` and `phone` (seeded).
- **Variant `card`:** "Questions?", the organiser's name, the number as selectable text, and a
  **Call** button (`tel:`). On desktop the number itself matters most, since `tel:` may do
  nothing there.

### Unknown types

Render nothing (C-15).

## 6. Replying (RSVP)

### 6.1 The flow

Personal link, replies open:

| Step | What appears |
|---|---|
| **1. The answer** | The question, "Will you join us?", or the RSVP block's `title`. Three large choice cards (a radio group): **Joyfully attending**, **Regretfully declining**, **Not sure yet**. Nothing is selected until the guest chooses, or until a saved answer is loaded |
| **2. The details,** after a choice | See below |
| **3. Send** | **Send reply** at full width on phones, with the line "You can change your reply with this link while replies are open" (C-21) |

**Details when attending:**

- **a. Who’s coming.** Shown when the household has other members or more than one seat.
  - "Seats reserved: 3", then each other member with a three-way control: *Attending*, *Not
    attending*, *Not sure*.
  - **Members start on the respondent's answer and can be changed one by one.** The usual case is
    "we're coming, grandma can't travel", and the list stays visible so nobody is answered for
    unseen.
- **b. Add a guest.** While seats remain: a row with first name (required) and last name
  (optional), repeatable, with "Seats remaining: 1". Added guests come with the respondent's
  answer and answer the host's questions for themselves (API.md §4, PD-38).
- **c. Who invited you?** The two side labels and **Both**, only when both labels exist and the
  invitation asks (`rsvpFields`).

Questions **d** to **f** and **h** are asked only when the invitation's `rsvpFields` switches them
on; sending one it switches off is refused (docs/API.md §4).

- **d. Dietary requirements.**
  - Chips for the invitation's own choices, sending their keys, and a field for "Anything else we
    should know?". Without choices, only the field: free text.
  - Each other attending person has the same, folded away under "Dietary needs for Lusine".
- **e. Drink preference.** The invitation's choices as radio cards (PD-32), or a short text field
  when it gives none. One per reply, for the respondent.
- **f. Song request.** A text field, up to 200 characters.
- **g. The host's questions,** in order:

  | Type | Control |
  |---|---|
  | TEXT | A text field, up to 500 characters |
  | LONG_TEXT | A text area, up to 4000 characters |
  | SINGLE_CHOICE | A radio list |
  | MULTI_CHOICE | Chips |
  | BOOLEAN | A yes / no control |
  | SIGNATURE | Not shown, because it cannot be answered (BQ-5) |

  "Required" is written as a word, never shown by colour alone.

  **Everyone coming answers them** (PD-38): a required question binds each attending member and
  added guest as it binds the respondent, so each has their own copy under their name, and each
  chooses their own meal. The respondent's go under their name too when anyone else is on the
  form.
- **h. A message for the hosts.** A text area, up to 1000 characters, optional.

**Other answers:**

- **Declining:** the household list, with members starting on *Not attending*, then the message.
  The host's required questions do not apply (C-17).
- **Not sure yet:** the household list, the message, and a line saying the reply can be changed
  later.

### 6.2 States

| State | What the guest sees |
|---|---|
| **Not answered** | The flow above, with nothing chosen |
| **Answered** | A summary first: "Your reply: Attending · 3 people", the date, and **Change reply**, which opens the form filled from `GET …/rsvp`. The reply bar shows the status |
| **Sending** | The button reads "Sending…", is busy (`aria-busy`) and cannot be pressed again. The fields stay visible |
| **Sent** | A confirmation replaces the form: "Thank you", what was sent (who is coming), "You can change your reply with this link while replies are open" (C-21), and **Change reply**. Focus moves to the heading. It does **not** promise an email: a household with no address receives none (API.md §4) |
| **Validation error (400)** | A summary at the top of the form lists each problem as a link to its field; each field shows its own message. Messages starting `members:`, `answers:` or naming seat counts map to their sections |
| **Too many guests (400)** | Shown on the party section: "You have named more guests than your seats allow (3)" |
| **Closed** | A quiet banner: "Replies are closed. The details remain here for you." Their last reply, if any, is shown. No reply bar |
| **Closed while sending** | The same banner, above the form. The form is disabled, but what the guest typed stays visible |
| **Too many requests (429)** | "Too many attempts. Please wait a minute and try again." What the guest entered is kept |
| **Network failure or 5xx** | "We couldn’t send your reply. Check your connection and try again." A retry button, the entries kept, and a small reference code from `x-request-id` for support |
| **Link not recognised (404)** | The not-found page ([§7](#7-page-states-and-edge-cases)) |
| **Generic link** | No form. "To reply, open the personal link you received" |

### 6.3 Copy rules

- Warm, short sentences. No exclamation marks and no jokes.
- Name the person and the action: "Send reply", "Change reply", never "Submit".
- An error says what happened and what to do next, without apologising.

## 7. Page states and edge cases

| Case | Behaviour |
|---|---|
| **Loading** | The server sends the complete page. Placeholders appear only in the reply summary while the saved answer loads |
| **Not found** (bad link, draft, expired) | A burgundy page with the footer mark and: "This invitation isn’t available. Check the link you received, or ask the person who invited you." No event details: none are known |
| **Closed** | Readable; no form (§6.2) |
| **After the event** | The countdown is hidden. Replies close as the server says |
| **No cover photograph** | The typographic cover |
| **Very long names, venues or addresses** | Wrap and never truncate. The display size steps down past three lines |
| **Mixed scripts** | Armenian interface with Latin venue names, and the reverse, are expected wherever the host has not translated a name, and look intended |
| **One language** | No switcher |
| **Only the default blocks** | HERO, VENUE, TIMELINE, COUNTDOWN and RSVP (`backend/src/modules/events/default-blocks.ts`) still make a complete page |
| **No music** | No control |
| **200 % text zoom, 320 px wide** | One column; nothing scrolls sideways |

## 8. Layout by screen size

Breakpoints are the Tailwind defaults ([DESIGN_SYSTEM §4](DESIGN_SYSTEM.md#4-space-layout-and-breakpoints)).

| Width | Layout |
|---|---|
| **Under 640** (drawn at 360 and 390) | One column. Gutters 20 px (16 px under 360). The cover's arch is 70 % of the width, capped at 300 px. Text column at most 34 rem. Sections 64–80 px apart. Reply bar shown |
| **640–767** | The same, with 32 px gutters and the column centred at 36 rem |
| **768–1023** | One column at 40 rem. 40 px gutters. Venue cards in pairs, gallery in three columns, an arch of 340 px. Reply bar shown |
| **1024 and up** | **The open card.** The left 5/12 (420–640 px) is the burgundy cover, pinned at full height (`100svh`), with **Reply** under the date. The right 7/12 scrolls the letter in a column of at most 42 rem with 64 px gutters. No reply bar |
| **HERO missing, or not first** | No pinned panel. One centred column on ivory, at most 44 rem, with the cover as a band at the top |

```
Phone, 390 wide                          Desktop, 1440 wide
┌──────────────────────────┐             ┌──────────────────┬────────────────────────────────┐
│ EN            ♪ Music    │  burgundy   │ pinned, burgundy │ scrolls, ivory                 │
│         WEDDING          │             │   WEDDING        │   YOUR INVITATION              │
│        ╭──────╮          │             │   ╭──────╮       │   Dear Armen Petrosyan,        │
│       ╱  arch  ╲         │             │  ╱  arch  ╲      │   Seats reserved: 3            │
│      │  photo   │        │             │ │  photo   │     │   ──────── ◆ ────────          │
│      └──────────┘        │             │ └──────────┘     │   OUR STORY                    │
│      Anna & Davit        │             │  Anna & Davit    │   UNTIL THE CELEBRATION        │
│       ──── ◆ ────        │             │   ── ◆ ──        │   42  06  15  09               │
│  SATURDAY, 12 JUNE 2027  │             │  12 JUNE 2027    │   VENUES  [card]   [card]      │
│  16:00 · YEREVAN TIME    │             │  16:00           │   THE DAY  ── timeline ──      │
└──────────────────────────┘             │  [ Reply ]       │   DRESS CODE  ▪ ▪ ▪            │
  ┌──────────────────────┐  porcelain    │                  │   ▓▓ reply band, form card ▓▓  │
  │ YOUR INVITATION      │  card, 32 px  │                  │   ▓▓ footer mark ▓▓            │
  │ Dear Armen Petrosyan,│  overlap      └──────────────────┴────────────────────────────────┘
  │ Seats reserved: 3    │                  5/12, 420–640        7/12, column ≤ 42rem
  │ [      Reply       ] │
  └──────────────────────┘
   … blocks in the host's order …
   ▓▓ reply band ▓▓  ▓▓ footer ▓▓
┌──────────────────────────┐
│ [         Reply        ] │  sticky reply bar, clear of the safe area
└──────────────────────────┘
```

## 9. Languages

- **`<html lang>`** is the response's `locale`.
- **Interface strings** come from i18next in `hy`, `ru` and `en`; **content** arrives already in the
  negotiated language. Host-typed names (hosts, venues) may be in another script, and they carry no
  `lang` of their own.
- **Dates and times** use `Intl.DateTimeFormat` with `timeZone: event.timezone` (C-16):
  - Recommended English form: "Saturday, 12 June 2027 · 16:00", day-month-year on a 24-hour
    clock (R-24, PQ-4).
  - Russian weekdays come out of `Intl` in lower case; they are capitalised at the start of a
    display line.
  - Armenian and Russian keep their own `Intl` forms ("2027 թ.", "2027 г.").
- **The time-zone label** reads "Yerevan time" (R-22), derived from the IANA zone, with translated
  city names in the interface strings.
- **Plurals** use `Intl.PluralRules`: Russian has one / few / many / other; Armenian and English
  have one / other. **"Label: N"** is preferred where it reads naturally (R-26): "Seats reserved:
  3", "Ամրագրված տեղեր՝ 3", "Забронировано мест: 3".
- **Greetings** carry no grammatical gender, because the API holds none (R-25). Russian uses the
  name and a neutral sentence: «Армен Петросян, будем рады видеть вас», never «Дорогой» or
  «Дорогая».
- **Armenian punctuation** is written with its own characters:
  - the full stop is `։` (U+0589), never a colon;
  - the question mark `՞` sits on the stressed vowel of the questioned word, not at the end;
  - the separator before a value is `՝`.
- **Quotation marks:** « » in Armenian and Russian, “ ” in English.
- **The language switcher** names each language in itself ("Հայերեն", "Русский", "English") and
  marks the current one with `aria-current`. It appears only under R-17.

## 10. Motion and sound

- **On load,** the cover's parts rise 8 px into place over 600 ms, 80 ms apart. Everything is
  already visible in the server's HTML; motion only adds to it.
- **Sections** never start hidden. A 300 ms rise of 8 px as they enter, at most.
- **Interface feedback:** colour and border transitions of 150–200 ms. No bounce, no parallax, no
  autoplaying video.
- **Under `prefers-reduced-motion`:** no movement at all; changes are instant.
- **Music** (R-20): off until pressed. It pauses when the page is hidden, the choice is remembered
  for the session, and the control says **Music: on** or **Music: off** in words.

## 11. Accessibility

The rules here are specific to this page; the system-wide rules are in
[DESIGN_SYSTEM §11](DESIGN_SYSTEM.md#11-accessibility).

- **Structure:**
  - one `h1`, the hosts' names; each section's heading is an `h2`;
  - landmarks: `header` (the top bar), `main`, `footer`;
  - a skip link, **Skip to reply**, when there is a reply section.
- **The cover photograph** uses its `altText`, or is decorative (`alt=""`) when it has none.
- **The music control** is a `button` with `aria-pressed` and a visible state in words.
- **The countdown** is not announced; the date beside it is plain text.
- **The reply form:**
  - every question is a `fieldset` with a `legend`, and choice cards are real radio buttons;
  - errors are linked to their fields with `aria-describedby`;
  - a failed send moves focus to the error summary, and a successful send to the confirmation
    heading.
- **The reply bar** never covers a focused field (`scroll-padding-bottom`).
- **Touch targets** are at least 44 × 44, and 48 px tall for primary buttons.
- Every text and background pair passes AA ([DESIGN_SYSTEM §11](DESIGN_SYSTEM.md#11-accessibility)).

## 12. Privacy

- **The capability-link rules apply** (C-18):
  - no analytics or third-party scripts;
  - `Referrer-Policy: no-referrer`;
  - outbound links use `rel="noreferrer noopener"`;
  - no embeds.
- **No share button** on a personalised page (R-18).
- **Link previews** carry the hosts and the occasion ("Anna & Davit · Wedding") and `coverUrl`,
  never the guest's name.
- **Mockups and screenshots** use sample links only (`…/g/SAMPLE`), never a real token.
- **The guest's name and household** appear only on their own page.

## 13. Sample content

> **SAMPLE.** The couple, Anna & Davit, is the demo event in `backend/prisma/seed.ts`. The other
> names, the venues, addresses, notes and the phone number are fictional. **Every Armenian and
> Russian string is a draft for a native reader to review** (AS-9, DQ-9). The seeded strings were
> written by the backend team; the rest are new.

| Where | English | Armenian | Russian |
|---|---|---|---|
| Occasion (WEDDING) | Wedding | Հարսանիք | Свадьба |
| Hosts, HERO `title` (seeded) | Anna & Davit | Աննա և Դավիթ | Анна и Давид |
| HERO `subtitle` | invite you to celebrate their wedding | հրավիրում են Ձեզ իրենց հարսանիքին | приглашают вас на свою свадьбу |
| Date line | Saturday, 12 June 2027 · 16:00 | Շաբաթ, 12 հունիսի 2027 թ. · 16:00 | Суббота, 12 июня 2027 г. · 16:00 |
| Time-zone label | Yerevan time | Երևանի ժամանակով | по ереванскому времени |
| Personal label | Your invitation | Ձեր հրավերը | Ваше приглашение |
| Greeting | Dear Armen Petrosyan, | Հարգելի Արմեն Պետրոսյան, | Армен Петросян, |
| Welcome line | We would be honoured to celebrate this day with you. | Մեծ պատիվ կլինի տոնել այս օրը Ձեզ հետ։ | Будем счастливы разделить этот день с вами. |
| Seats | Seats reserved: 3 | Ամրագրված տեղեր՝ 3 | Забронировано мест: 3 |
| Story (seeded) | We would be glad to share this important day with you. | Ուրախ կլինենք Ձեզ հետ կիսել մեր կյանքի այս կարևոր օրը։ | Мы будем рады разделить с вами этот важный день. |
| Countdown title | Until the celebration | Մինչև տոնը | До праздника |
| Countdown units | days · hours · minutes · seconds | օր · ժամ · րոպե · վայրկյան | дней · часов · минут · секунд (plural by number) |
| CEREMONY | Ceremony | Արարողություն | Церемония |
| RECEPTION | Reception | Խնջույք | Банкет |
| AFTER_PARTY · PREPARATION · OTHER | After-party · Getting ready · Other | Հետխնջույք · Նախապատրաստություն · Այլ | Афтепати · Сборы · Другое |
| Venue names (fictional, untranslatable) | Chapel of the Garden · Maison Lumière | the same Latin names | the same Latin names |
| Arrival | Arrive by 13:45 | Ժամանել մինչև 13:45 | Прибыть к 13:45 |
| Actions | Get directions · Copy address | Ինչպես հասնել · Պատճենել հասցեն | Как добраться · Скопировать адрес |
| Timeline title | The day | Օրվա ծրագիրը | Программа дня |
| Timeline (seeded) | Ceremony · Guest reception · Dinner · Cake cutting | Պսակադրություն · Հյուրերի դիմավորում · Հարսանյաց հանդես · Տորթի կտրում | Венчание · Встреча гостей · Банкет · Торт |
| Dress code title | Dress code | Հագուստի կոդ | Дресс-код |
| Dress code (seeded) | Evening wear | Երեկոյան զգեստներ | Вечерний наряд |
| Notes title | A few requests | Մի քանի խնդրանք | Несколько пожеланий |
| Note: flowers | Instead of flowers, a card with a few words would mean the world to us. | Ծաղիկների փոխարեն մեզ համար թանկ կլինի մի քանի ջերմ խոսքով բացիկը։ | Вместо цветов нам будет очень приятно получить открытку с парой тёплых слов. |
| Note: photographs | During the ceremony, please leave the photographs to our photographer. | Արարողության ընթացքում խնդրում ենք լուսանկարելը թողնել մեր լուսանկարչին։ | Во время церемонии, пожалуйста, доверьте фотосъёмку нашему фотографу. |
| Gallery title | Moments | Պահեր | Моменты |
| Reply title | Kindly reply | Խնդրում ենք պատասխանել | Пожалуйста, ответьте |
| Host's reply line (free text) | Please let us know by 1 May 2027. | Խնդրում ենք տեղեկացնել մինչև 2027 թ. մայիսի 1-ը։ | Пожалуйста, сообщите нам до 1 мая 2027 г. |
| Question | Will you join us? | Կմասնակցե՞ք | Вы будете с нами? |
| ATTENDING | Joyfully attending | Սիրով կմասնակցեմ | С радостью приду |
| DECLINED | Regretfully declining | Ցավոք, չեմ կարող մասնակցել | К сожалению, не смогу |
| UNDECIDED | Not sure yet | Դեռ չգիտեմ | Пока не знаю |
| Household title | Who’s coming | Ովքեր կգան | Кто придёт |
| Member states | Attending · Not attending · Not sure | Կգա · Չի գա · Դեռ հայտնի չէ | Придёт · Не придёт · Пока неизвестно |
| Add a guest | Add a guest | Ավելացնել հյուր | Добавить гостя |
| Seats remaining | Seats remaining: 1 | Մնացած տեղեր՝ 1 | Свободных мест: 1 |
| Name fields | First name · Last name (optional) | Անուն · Ազգանուն (ըստ ցանկության) | Имя · Фамилия (необязательно) |
| Who invited you | Who invited you? · Both | Ո՞վ է Ձեզ հրավիրել · Երկուսն էլ | Кто вас пригласил? · Оба |
| Dietary title | Dietary requirements | Սննդային պահանջներ | Особенности питания |
| Dietary choices (a host's example, PQ-1) | Vegetarian · Vegan · Gluten-free · Lactose-free · Nut allergy | Բուսակեր · Վեգան · Առանց գլյուտենի · Առանց լակտոզայի · Ընկույզի ալերգիա | Вегетарианское · Веганское · Без глютена · Без лактозы · Аллергия на орехи |
| Dietary notes | Anything else we should know? | Ուրիշ ի՞նչ պետք է իմանանք | Что ещё нам стоит знать? |
| Drink title | Drink preference | Նախընտրած ըմպելիք | Предпочтения по напиткам |
| Drink choices (a host's example, PQ-2) | Wine · Champagne · Spirits · Non-alcoholic | Գինի · Շամպայն · Թունդ խմիչք · Ոչ ալկոհոլային | Вино · Шампанское · Крепкие напитки · Безалкогольные |
| Song | Your song · Which song will get you dancing? | Ձեր երգը · Ո՞ր երգով կպարեք | Ваша песня · Под какую песню вы пойдёте танцевать? |
| Message | A message for the hosts | Ձեր խոսքը հյուրընկալողներին | Сообщение для хозяев праздника |
| Required · Optional | Required · Optional | Պարտադիր · Ըստ ցանկության | Обязательно · Необязательно |
| Send | Send reply · Sending… | Ուղարկել պատասխանը · Ուղարկվում է… | Отправить ответ · Отправляем… |
| Reassurance (corrected 18 October, C-21; Armenian and Russian newly drafted) | You can change your reply with this link while replies are open. | Պատասխանը կարող եք փոխել այս հղումով, քանի դեռ պատասխանների ընդունումը բաց է։ | Вы можете изменить ответ по этой ссылке, пока приём ответов открыт. |
| Sent | Thank you · Your reply has been received. | Շնորհակալություն · Ձեր պատասխանը ստացվել է։ | Спасибо · Ваш ответ получен. |
| Change | Change reply | Փոխել պատասխանը | Изменить ответ |
| Status chip | You’re attending · You’re not attending · Not decided yet | Դուք կմասնակցեք · Դուք չեք մասնակցի · Դեռ որոշված չէ | Вы придёте · Вы не придёте · Пока не решено |
| Closed | Replies are closed. The details remain here for you. | Պատասխանների ընդունումն ավարտված է։ Մանրամասները մնում են այստեղ։ | Приём ответов завершён. Все подробности остаются здесь. |
| Generic link | To reply, open the personal link you received. | Պատասխանելու համար բացեք Ձեզ ուղարկված անձնական հղումը։ | Чтобы ответить, откройте личную ссылку из приглашения. |
| Network error | We couldn’t send your reply. Check your connection and try again. | Չհաջողվեց ուղարկել պատասխանը։ Ստուգեք կապը և փորձեք կրկին։ | Не удалось отправить ответ. Проверьте подключение и попробуйте ещё раз. |
| Too many guests | You have named more guests than your seats allow (3). | Ավելի շատ հյուր եք նշել, քան ամրագրված տեղերն են (3)։ | Вы указали больше гостей, чем забронировано мест (3). |
| Too many attempts | Too many attempts. Please wait a minute and try again. | Չափազանց շատ փորձեր։ Սպասեք մեկ րոպե և փորձեք կրկին։ | Слишком много попыток. Подождите минуту и попробуйте снова. |
| Not found | This invitation isn’t available. Check the link you received, or ask the person who invited you. | Այս հրավերը հասանելի չէ։ Ստուգեք ստացած հղումը կամ դիմեք Ձեզ հրավիրողին։ | Это приглашение недоступно. Проверьте ссылку или обратитесь к тем, кто вас пригласил. |
| Music | Music: on · Music: off | Երաժշտություն՝ միացված · անջատված | Музыка: вкл. · выкл. |
| Contact | Questions? · Call | Հարցե՞ր ունեք · Զանգահարել | Есть вопросы? · Позвонить |
| Chat | Join the guest chat | Միանալ հյուրերի զրուցարանին | Присоединиться к чату гостей |
| Reply bar | Reply | Պատասխանել | Ответить |
| Organiser and phone (fictional) **⚠** the organiser conflicts with C-12 (VR-02, PD-20) | Aveline Events · +374 00 000 000 | the same | the same |

## 14. The artboards

**[Aveline Guest Invitation](https://claude.ai/artifact/1UPc5z5stPwZNc5ntdU5s8)** is a design
canvas on claude.ai.

- **Published:** 13 October 2026, version `1791838055-6cae`.
- **Design system:** the [Aveline Events](https://claude.ai/artifact/6qY7NZvDFBmnF4XnKeDawo)
  system is installed on it.
- **Private** until the frontend lead shares it.
- **Its photographs are placeholders,** listed in [PLACEHOLDER_IMAGES.md](PLACEHOLDER_IMAGES.md).
  A note on the canvas says so.
- **Reviewed** on 13 October 2026 and re-verified on 18 October. The findings, the fixes and their
  status are in [DESIGN_REVIEW.md](DESIGN_REVIEW.md); the latest version seen is in
  [README §3](README.md#3-the-artifacts).

| Row | Artboard | Size | Shows |
|---|---|---|---|
| Phone · English | `Main` | 390 × 5300 | The whole invitation on a personal link, in the template's default block order |
| | `First-screen` | 390 × 844 | The first screen: occasion, hosts and date before any scrolling, with the sticky reply bar |
| | `Small-phone` | 360 × 800 | The same first screen on a small phone |
| Replying | `Reply-attending` | 390 × 2900 | Attending, household member, an added guest filling the last seat, side, dietary, drink, song, the seed's custom question, message |
| | `Reply-declined` | 390 × 1150 | Declining; the household still answered person by person |
| | `Reply-error` | 390 × 1500 | Error summary, a household member, too many guests, a required question unanswered |
| | `Reply-sent` | 390 × 900 | The confirmation and what was sent |
| | `Reply-closed` | 390 × 760 | Replies closed; the last reply shown |
| Languages | `Armenian` | 390 × 2000 | Cover, personal card, timeline and venue in Armenian. The Latin venue name shows one the host has not translated |
| | `Russian` | 390 × 2000 | Cover, personal card in the answered state, countdown with Russian plurals, venue, dress code |
| Tablet and desktop | `Tablet` | 768 × 2300 | One column, venues in pairs, a three-column gallery, the reply bar |
| | `Desktop` | 1440 × 900 | The open card: the cover pinned left with Reply, the letter on the right |
| | `Desktop-reply` | 1440 × 900 | The same, scrolled to the reply section, music on |
| Edge states | `Cover-typographic` | 390 × 844 | No cover photograph |
| | `Cover-full-bleed` | 390 × 844 | The full-bleed cover variant, with the names on a dark gradient |
| | `Cover-champagne` | 390 × 844 | The alternative palette: a sand cover with burgundy names |
| | `Not-found` | 390 × 844 | A link that does not open an invitation |

**The artboards are static mockups.** Reviewers can leave comments on them in the canvas. When a
comment changes the design, update this file in the same change.

## 15. Not yet built

- **In code since 22 October 2026, not yet against the real backend:** the renderer with all
  fourteen blocks, both guest routes and the reply flow, on the provisional defaults
  ([DESIGN_DECISIONS §6](DESIGN_DECISIONS.md#6-provisional-defaults)). They were checked in a
  browser against a mock of the API; the end-to-end tests wait for the local backend to run. Not
  yet in code:
  - the `full-bleed` cover variant, which falls back to the arch (PD-37);
  - the motion in §10: the cover settling on load and sections rising as they enter. The page
    is complete without them;
  - remembering the music choice for the session (§10). The music is off on every load, since
    browsers do not play sound before a press.
- **The template "Maison"** as a database row: palettes, variants and fonts (R-27 to R-29). The
  backend inserts it.
- **What the backend has to answer or build:** palette colours and roles in the guest payload
  (BQ-1 to BQ-3), the signature-question guard (BQ-5), a reply-by date (BQ-7), a safe Telegram link
  (BQ-11), and members' earlier answers on an edit (FR-21).
- **Designs the backend's new data waits for:** the guest's table (`guest.seating`), map
  coordinates and the Telegram link (§3).
- **Product decisions:** the default dietary and drink choices offered to hosts, and which
  built-in questions are on by default (PQ-1 to PQ-3).
- **Copy review:** all Armenian and Russian copy by a native reader (DQ-9).
- **The review's fixes** ([DESIGN_REVIEW §5](DESIGN_REVIEW.md#5-fixes)): all nine
  frontend-owned ones were applied on 18 October. The fourteen owned by others are not.
