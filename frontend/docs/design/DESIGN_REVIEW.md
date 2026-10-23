# Design review

> **Status: open register.** The review ran on 13 October 2026. It was re-verified against the
> current artifact files and corrected on 18 October 2026.
>
> - **What was reviewed:** the Aveline Events design system and the 17 artboards of the guest
>   invitation canvas, against [BRAND_BRIEF.md](BRAND_BRIEF.md),
>   [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md), the specs and `docs/API.md`.
> - **All nine frontend-owned fixes were applied on 18 October:** 1, 4, 8, 11, 16, 18, 19, 22
>   and 23, on the canvas, the design system and the spec (§5). The others wait for their owner. Until then, build on the working defaults in
>   [DESIGN_DECISIONS §6](DESIGN_DECISIONS.md#6-provisional-defaults).
> - **The published review page** ([Aveline Design Review](https://claude.ai/artifact/XGY21GRtMK6JFueWda51YM),
>   version `1791906128-e0d4`) is a snapshot of 13 October. Where it and this file differ, this
>   file is right: three findings were corrected on 18 October (§2).

## 1. How to read this file

**Finding IDs** (`VR-01` to `VR-36`) are stable and never reused. The question numbers on the
review page (`Q1`–`Q11`) are mapped to register IDs in
[DESIGN_DECISIONS §5](DESIGN_DECISIONS.md#5-unresolved-questions).

| Kind | Meaning |
|---|---|
| **Rendering** | The artifact draws something broken: clipped, wrapped inside a word or a name, overlapping |
| **Inconsistency** | Two places that should match don't, or a board contradicts the spec |
| **Accessibility** | Fails or risks WCAG 2.2 AA, or misses the system's own rule |
| **Copy** | Wording that is wrong, or differs from the spec |
| **Decision** | Shows as settled something the brief or the decisions register leaves open |
| **Coverage** | A state, size or language the spec describes that nothing draws |

**Status:** *Open*, *Fixed* (with the date and the change), or *Won't fix* (with the reason and
who decided). A fix updates this file, the governing spec and the artifact in the same change.

## 2. Corrections made on 18 October

The review page carries these three as they were first written. They are corrected here.

| ID | The review page says | What is true |
|---|---|---|
| VR-09 | The drink chips "look and behave like a multi-select" | They **behave** correctly: they are radio buttons, one answer, like `drinkPreference`. Only the **look** is wrong: they copy the multi-select chip, check mark included |
| VR-11 | Reply-error's first error link, "Choose an answer for Lusine Petrosyan", has no target | That text is the design system's ErrorSummary sample, not the board. **Both links on the board reach their fields.** The real gap: Reply-error shows no household member rows, so the per-person error that the sample describes cannot be shown |
| VR-12 | Answer cards are 48 px on Reply-error and 56 px on every other reply board | True for the **attendance** cards. Also: the custom-question cards (side, arrival) are 48 px on every board, while the design system's ChoiceCard is 56 px |

Fix 8 in §5 is reworded to match.

## 3. What was checked

| Artifact | Reviewed on 13 October | Seen on 18 October | How it was re-verified |
|---|---|---|---|
| [Design system "Aveline Events"](https://claude.ai/artifact/6qY7NZvDFBmnF4XnKeDawo) | `1791837143-7e7e` (page re-saved as `1791837147-6751`) | `1792311699-2b48` | `tokens.json` SHA-256 `713cbb7ca577b318…` unchanged; component styles and READMEs re-read; every design-system finding still matches the source |
| [Canvas "Aveline Guest Invitation"](https://claude.ai/artifact/1UPc5z5stPwZNc5ntdU5s8) | The content published on 13 October as `1791838055-6cae`; the later 13 October versions were automatic page saves | `1792311698-0d0b` | All 17 boards re-read and re-rendered. Every rendering finding re-measured; three findings corrected (§2) |

The two 18 October versions were published one second apart and the gallery still shows the
artifacts as last updated on 12 October. They are assumed to be automatic saves with no design
change ([AS-12](DESIGN_DECISIONS.md#4-assumptions)).

**After the fixes (18 October):**

- **Canvas:** `1792313766-046c`; `1792316472-b27f` once its boards read the tokens (fix 22).
- **Design system:** `1792313839-12ae`; `1792315900-1f30` with the token `error-ink-hover`.
- **Re-measured:**
  - Reply-attending's content (2,823 px) fits its 2,900 px board;
  - no name breaks inside;
  - Reply-error has 56 px attendance cards and 44 px error links, and fits its 1,500 px board;
  - the tablet reply button is 640 px;
  - "at any time" appears nowhere on either artifact.

**Method:**

- Rendered in headless Chrome at 2×, with the real Google-hosted Noto fonts: the boards at their
  canvas sizes, and the 21 component previews and the cover (the cover in both themes).
- Content height, wrapping and overflow measured from the rendered page.
- Contrast sampled from rendered pixels.
- Text compared with the specs, and the dress-code and theme data with the backend's seed.

**Not covered:** real phones and iOS Safari, screen readers, keyboard order, live behaviour (the
boards are static), and a native reading of the Armenian and Russian strings.

## 4. Findings

### 4.1 On the canvas

In canvas order. A finding seen on several boards is listed once.

| ID | Where | Kind | Finding | Status |
|---|---|---|---|---|
| VR-01 | Main, Tablet, Russian | Rendering | Household name lists break inside an item: "1 seat / to name" (Main), "Lusine / Petrosyan" (Tablet), "Нарек / Петросян" (Russian). The design system's PersonalCard separates names with spacing; the canvas uses " · " | **Fixed** 18 Oct (fix 4): each name is an unbreakable span on Main, Tablet, Russian and Reply-sent; `.av-names li` no longer wraps in the design system |
| VR-02 | Main; also [GUEST_INVITATION §13](GUEST_INVITATION.md#13-sample-content) | Decision | The contact block's sample organiser is "Aveline Events": a second appearance of the brand on the guest page, which C-12 limits to the footer mark | Open, PQ-9 |
| VR-03 | Main, Reply-attending, Reply-declined, Reply-sent; the design system's Link and Notice; [GUEST_INVITATION](GUEST_INVITATION.md) §6.1, §6.2, §13 | Copy | "You can change your reply at any time with this link" is false once replies close: the backend then refuses changes too (C-21) | **Fixed** 18 Oct (fix 16): "…with this link while replies are open." on the four boards, the Link and Notice previews, the spec and the `tokens.json` Russian type sample; Armenian and Russian drafted |
| VR-04 | Main, Desktop-reply; the rule in the ReplyBar README | Inconsistency | Two identical primary Reply buttons share the screen. The reply bar hides only while the reply section is visible, so after the first scroll the personal card's Reply and the bar's Reply show together. On desktop the pinned cover keeps its Reply beside the open form | Open |
| VR-05 | First-screen, Small-phone | Rendering | At 390 × 844 only the personal card's "YOUR INVITATION" label shows above the reply bar (label at 738 px, greeting at 766 px, bar from about 763 px). At 360 × 800 the greeting shows. Spec §1 asks for the occasion, hosts and date on the first screen and the guest's name within one scroll, so this is a composition problem, not a breach | Open |
| VR-06 | Reply-attending | Rendering | The content is 2,823 px tall on a 2,600 px board: Send reply and the line under it are cut off | **Fixed** 18 Oct (fix 1): board 2,900 px; the rows below moved down 300 px |
| VR-07 | Reply-attending, Reply-declined | Rendering | "Not attending" wraps to two lines in the per-person status control at 390 px | Open |
| VR-08 | Reply-attending | Inconsistency | Three option cards are selected; only the attendance card shows the check mark (the side and arrival cards don't) | Open |
| VR-09 | Reply-attending | Inconsistency | The drink options are radio buttons, but they are drawn exactly like the multi-select dietary chips, check mark included, so they look multi-select. Spec §6.1e asks for "single-choice chips"; the design system's Chip is multi-choice only. *Corrected on 18 October (§2)* | Open |
| VR-10 | Reply-attending | Decision | The dietary and drink options look final. They are samples (PQ-1, PQ-2, AS-7), and the contract has free strings with no option lists. The design system's Chip preview says "sample options"; the board doesn't. *23 October 2026: each invitation now gives its own choices (`rsvpFields`), so the board's options read as one host's; what stays open is product's default list (PQ-1, PQ-2)* | Open |
| VR-11 | Reply-error | Inconsistency | The board shows no household member rows, unlike Reply-attending and Reply-declined, so a per-person error cannot be shown. The design system's ErrorSummary sample ("Choose an answer for Lusine Petrosyan") describes exactly that case. *Corrected on 18 October (§2)* | **Fixed** 18 Oct (fix 8): Lusine’s row added, with "Guests you added" above the party |
| VR-12 | Reply-error, and every reply board | Inconsistency | Attendance cards are 48 px on Reply-error and 56 px on Main, Reply-attending, Reply-declined and Desktop-reply. Custom-question cards are 48 px everywhere; the design system's ChoiceCard is 56 px. *Refined on 18 October (§2)* | **Partly fixed** 18 Oct (fix 8): attendance cards 56 px everywhere. The custom-question cards stay open (fix 9, PD-33) |
| VR-13 | Reply-error | Accessibility | The error-summary links are 42 px and 20 px tall, under the system's 44 px target. They pass WCAG 2.2's 24 px minimum through its spacing exception | **Fixed** 18 Oct (fix 8): both links 44 px tall |
| VR-14 | Reply-sent | Inconsistency | The confirmation sits under "Kindly reply / Will you join us?", and "Your reply has been received." comes before the "Thank you" heading. Spec §6.2: the confirmation replaces the form, and focus moves to its heading | Open |
| VR-15 | Reply-closed | Copy | Board: "Replies are closed. The hosts are no longer taking replies. The details remain here for you." Spec §6.2 and §13: "Replies are closed. The details remain here for you.", with Armenian and Russian | **Fixed** 18 Oct (fix 18): the board uses the spec’s sentence |
| VR-16 | Armenian | Inconsistency | The music label, "Երաժշտություն՝ անջատված", is in sentence case. The English and Russian labels, and every other Armenian label in the design system, are in capitals | Open |
| VR-17 | Russian | Copy | The cover date is set in capitals, so "12 июня 2027 г." renders as "2027 Г.". A Russian reader decides | Open |
| VR-18 | Russian | Coverage | Only the answered state is drawn. The reply form in Russian, the longest of the three languages, isn't drawn at 360 or 390 px | Open |
| VR-19 | Tablet | Inconsistency | The reply bar's button is 688 px wide (40 px gutters at 768); the text column is 640 px | **Fixed** 18 Oct (fix 11): the cause was `width: 640px` plus padding without `box-sizing: border-box`; it is 640 px now |
| VR-20 | Tablet | Inconsistency | Copy address has no icon on the tablet; on phones (Main, Armenian) it has one | **Fixed** 18 Oct (fix 11) |
| VR-21 | Desktop-reply | Rendering | The three attendance cards wrap unevenly: "Joyfully / attending" and "Regretfully / declining" take two lines, "Not sure yet" one. At 1,024 px (not drawn) each would be about 125 px wide | Open |
| VR-22 | Desktop-reply | Decision | The cover's Reply button is filled with blush, `#FFEBF6`, following the Bordeaux `action` token, which depends on DQ-2 | Open |
| VR-23 | Cover-full-bleed | Accessibility | Text over the photograph measures 5.2:1 to 12.5:1 on this photo only. Host photos vary | Open |
| VR-24 | Cover-champagne | Decision | The champagne palette is a proposal (DQ-11, R-28), and two of its colours, `#F6F1EB` and `#735530`, aren't in `tokens.json` | Open |
| VR-25 | All | Coverage | Five of the twelve reply states in spec §6.2 have no artboard; two of them exist only as design-system components (§6) | Open |
| VR-26 | All | Coverage | No board shows 1,024 px, the narrowest desktop layout, and the footer mark is never drawn at tablet or desktop size | Open |
| VR-27 | All | Inconsistency | Every board hardcodes its colours; none reads a token, so changing `tokens.json` changes nothing on the canvas. Four colours aren't tokens: `#F6F1EB` and `#735530` (Cover-champagne), `#7D1D23` (the error-link hover on Reply-error), `#FFFFFF` (Not-found) | **Fixed** 18 Oct (fix 22): every board links the canvas copy of `frontend/src/styles/tokens.css` and uses token variables. `#7D1D23` became the token `error-ink-hover`; `#FFFFFF` became `porcelain`. A before-and-after render of Reply-error is pixel-identical. **Won't fix:** the champagne colours `#F6F1EB` and `#735530` stay local to their board, because the palette is a proposal (PD-8); the dress-code swatches stay literal, because they are the host's data |
| VR-28 | Six boards | Copy | The English copy uses straight apostrophes: can't, isn't, You're, Who's | **Fixed** 18 Oct (fix 19): ’ on the six boards, in the design-system previews and README example, and in the spec’s sample strings |

### 4.2 In the design system

| ID | Component | Kind | Finding | Status |
|---|---|---|---|---|
| VR-29 | ReplyBar | Rendering | In the answered state at 390 px, "YOU'RE ATTENDING · 3" and "CHANGE REPLY" each wrap to two lines: the status and the button share the row and grow equally (`flex: 1 1 auto`). No board draws this state | Open |
| VR-30 | VenueCard | Rendering | When "Скопировать адрес" wraps under the directions button, it sits about 9 px in from the card's text edge (the quiet button's padding and border) | **Fixed** 18 Oct (fix 23): no side padding on a quiet button in the actions row |
| VR-31 | ChoiceCard | Inconsistency | The design system draws its own radio and a check mark on the selected card. The canvas uses the browser's radios, tinted with `accent-color`, and shows the check mark once (VR-08) | Open |
| VR-32 | StatusChip, ReplyBar | Copy | "You're attending · 3" has no unit. Spec §6.2 says "Attending · 3 people" | Open |
| VR-33 | Notice | Inconsistency | The network-error notice has no reference code. Spec §6.2 asks for one, from `x-request-id` | Open |
| VR-34 | Countdown, and Main | Accessibility | The seconds change every second. WCAG 2.2.2 asks for a way to pause, stop or hide content that updates itself for more than five seconds | Open |
| VR-35 | Swatches | Accessibility | The colours have no names, so a screen reader hears only "Suggested colours". The README records why: the backend sends hex values (BQ-10) | Open |
| VR-36 | MemberStatus | Coverage | Previewed at about 408 px, wider than a phone's column, so it hides VR-07. No Russian preview | Open |

### 4.3 Suggestions

Matters of taste for the designer. They are not findings and carry no status.

- A lighter music control: an icon with a short label, in place of the bordered capitals button.
- Balance the centred story paragraph so it doesn't end on a short line.
- Shorten the 144 px gap before the reply section.
- Smaller names on the desktop cover, relative to the arch.
- Separate the desktop reply band from the cover panel; both are burgundy and read as one block.
- Sentence case for quiet buttons such as Copy address; capitals with an underline read like a
  heading.
- Drop the "Replies" label above "Replies are closed".
- One convention for required and optional fields: the form shows "Required" on one question and
  "(optional)" on others.
- Trim the empty space at board bottoms: Reply-sent 240 px, Reply-closed 238 px, Armenian 113 px,
  Reply-declined 104 px, Reply-error 101 px.
- The language switcher's closed trigger sized to its content.
- Eight design-system previews are taller than their declared cards. Nothing is clipped.

## 5. Fixes

In the suggested order. **Nine are applied** (18 October); the rest are not started.

- **Who can approve a fix:** the frontend lead can approve the ones owned by Frontend. Fixes
  owned by the designer, product or the backend wait for them.
- **Building before a fix lands:** follow the direction in the last column. These directions are
  the provisional defaults in [DESIGN_DECISIONS §6](DESIGN_DECISIONS.md#6-provisional-defaults).

| # | Priority | Fix | Owner | Findings | Status | Direction until confirmed |
|---|---|---|---|---|---|---|
| 1 | P1 | Extend Reply-attending to about 2,850 px so the whole state shows | Frontend | VR-06 | **Done** 18 Oct (2,900 px) | n/a |
| 2 | P1 | Redesign the answered reply bar for phones, and draw it on a board | Designer, Frontend | VR-29 | Not started | PD-27 |
| 3 | P1 | Stop labels wrapping inside answer controls; preview the member status at a real phone width and in Russian | Designer, Frontend | VR-07, VR-21, VR-36 | Not started | PD-28 |
| 4 | P1 | Keep each name on one line | Frontend | VR-01 | **Done** 18 Oct | PD-29 stays the rule for code |
| 5 | P1 | Settle the first screen, so the 360 and 390 boards agree | Designer | VR-05 | Not started | PD-30 |
| 6 | P2 | Show one Reply button at a time | Designer | VR-04 | Not started | PD-31 |
| 7 | P2 | Give single-choice options, such as drink, a look distinct from the multi-select chips | Designer, Frontend | VR-09 | Not started | PD-32 |
| 8 | P2 | Complete the validation-error board: add the household member rows, make the attendance cards 56 px, bring the error links to 44 px | Frontend | VR-11, VR-12, VR-13 | **Done** 18 Oct | PD-33 |
| 9 | P2 | One look for a selected answer, and one radio style | Designer, Frontend | VR-08, VR-31 | Not started | PD-33 |
| 10 | P2 | One rule for Armenian capitals, decided with an Armenian reader | Designer, native reader | VR-16 | Not started | PD-10 |
| 11 | P2 | Align the tablet reply bar with the column; give Copy address its icon there | Frontend | VR-19, VR-20 | **Done** 18 Oct | n/a |
| 12 | P2 | Guarantee contrast on the full-bleed cover | Designer | VR-23 | Not started | PD-34 |
| 13 | P2 | Calm the countdown | Designer | VR-34 | Not started | PD-35 |
| 14 | P2 | Give the sent state its own heading | Designer | VR-14 | Not started | PD-36 |
| 15 | P2 | Draw the missing reply states, the Russian form, a 1,024 px board and the footer mark at wide sizes | Designer, Frontend | VR-18, VR-25, VR-26 | Not started | PD-37 |
| 16 | P3 | Correct "change your reply at any time" on the canvas, in the design system and in the spec, together | Frontend | VR-03 | **Done** 18 Oct | PD-13, closed |
| 17 | P3 | Say what the number in the status counts | Designer | VR-32 | Not started | PD-14 |
| 18 | P3 | One wording for the closed state | Frontend | VR-15 | **Done** 18 Oct | PD-14 |
| 19 | P3 | Typographic apostrophes | Frontend | VR-28 | **Done** 18 Oct | PD-14 |
| 20 | P3 | The Russian date in capitals | Native reader | VR-17 | Not started | PD-12 |
| 21 | P3 | The reference code in the network-error notice | Designer | VR-33 | Not started | PD-14 |
| 22 | P3 | Make the boards read the tokens; add any off-token colour that stays to `tokens.json` | Frontend | VR-27 | **Done** 18 Oct | n/a |
| 23 | P3 | Fix the indent of a wrapped Copy address | Frontend | VR-30 | **Done** 18 Oct | n/a |

Findings without a fix of their own are covered by a decision: VR-02 (PQ-9, PD-20), VR-10 (PQ-1,
PQ-2; PD-15 closed on 23 October, when `rsvpFields` arrived), VR-22 (DQ-2, PD-4), VR-24 (DQ-11, PD-8) and VR-35 (BQ-10, PD-26).

## 6. Reply states

The twelve states in [GUEST_INVITATION §6.2](GUEST_INVITATION.md#62-states), and two more the
spec describes elsewhere.

| State | Drawn on | Coverage |
|---|---|---|
| Not answered | Main | Drawn |
| Answered | Russian. The answered reply bar is not drawn (VR-29) | Drawn |
| Sending | The design system's Button, "busy", only | Partial |
| Sent | Reply-sent (VR-14) | Drawn |
| Validation error | Reply-error (VR-11 to VR-13) | Drawn |
| Too many guests | Reply-error, first message | Drawn |
| Closed | Reply-closed (VR-15) | Drawn |
| Closed while sending | None | Missing |
| Too many requests (429) | None | Missing |
| Network failure or 5xx | The design system's Notice only, without the reference code (VR-33) | Partial |
| Link not recognised (404) | Not-found | Drawn |
| Generic link | None | Missing |
| "Not sure yet" answer (§6.1) | None | Missing |
| The reply form in Russian | None (VR-18) | Missing |

## 7. What works

- **Fonts:** the real Noto fonts render in all three scripts. Armenian glyphs, the Armenian full
  stop `։` and the abbreviation "թ." are right.
- **Logo:**
  - it is the unchanged file, sharp, about 170 px wide (above the 140 px minimum), only ever on
    burgundy, with alt text;
  - it appears once on the guest page, as the footer mark, and on the not-found page.
- **Drawing:** the arch, the timeline and the dividers line up at every size, and no board scrolls
  sideways.
- **Russian:** the countdown plurals are right, and the greeting is gender-neutral.
- **Contrast:** every text pair measured passes WCAG AA, including the champagne palette and the
  full-bleed cover on its current photo.
- **States:** every control in the design system has a visible focus state. Errors use an icon and
  words, and statuses use a shape and words, never colour alone. The Button preview covers every
  state, including busy.
- **Consistency:** the not-found copy matches the spec in all three languages. The tokens are
  identical in the design system and in the canvas's installed copy.

## 8. Not yet done

- **Fourteen fixes are not applied:** the ones owned by the designer, product or a native reader.
- **The review page is not corrected.** It stays a snapshot; this file supersedes it.
- **A second review,** after the P1 and P2 fixes, on real phones (iOS Safari and Android Chrome)
  with a screen reader.
- **Native readings** of the Armenian and Russian strings (DQ-9).
