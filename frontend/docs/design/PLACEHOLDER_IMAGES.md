# Placeholder images

> **Status: open. Every image below must be replaced before launch.** Written on 13 October 2026.
>
> **Why these images exist:**
>
> - The frontend lead decided on 12 October 2026 (C-10 in [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md))
>   that photographs from the two reference sites may stand in as placeholders in the mockups,
>   provided each one is documented so it can be replaced with Aveline's own images during
>   development or before launch.
> - They are third-party, copyrighted photographs. **None is licensed to Aveline.**

## Rules while they exist

- **They live only on the private design canvas** (linked in
  [GUEST_INVITATION.md §14](GUEST_INVITATION.md#14-the-artboards)).
- **They are never copied** into this repository, the application, the design-system artifact, marketing
  material or anything shown outside the team.
- **Keep the canvas private** (claude.ai's default) until every placeholder is replaced. Share it
  only with people working on Aveline.
- **Choosing a placeholder:** shots without identifiable faces were preferred.
  - PH-02 shows a person without the face.
  - PH-09 shows a couple whose faces are small and in profile. It is used once, for the full-bleed
    cover variant.
- **On the guest page in production, the photographs are the host's own uploads.** What needs
  replacing is the imagery Aveline itself shows: these mockups, and any future sample, template
  preview or marketing image.

## Register

`From` is the reference the photograph came from ([REFERENCE_ANALYSIS.md](REFERENCE_ANALYSIS.md)).
The repository does not name the sites; each file's source path is in the git-ignored
`docs/design/research/REFERENCE_SOURCES.md` on the frontend lead's machine, and the SHA-256
prefix identifies the file. `Canvas asset` is the upload's id in the canvas's asset store.

| ID | Subject | People | From | SHA-256 (first 16) | Canvas asset | Used on (artboards) |
|---|---|---|---|---|---|---|
| PH-01 | Bride holding white orchids with burgundy accents | Torso only, no face | Reference B | `7bf81e11f370f8b0` | `dc9e4c910c2f4a98f92f7d1ff9589e6a` | The cover on Main, First-screen, Small-phone, Armenian, Russian, Tablet, Desktop, Desktop-reply |
| PH-02 | Bouquet of poppies in sunlight, white dress | Partial, face not shown | Reference B | `f716d9b3e4ef53f9` | `14bb7835f29992df62ca3c841f53ce53` | Gallery on Main and Tablet; the cover on Cover-champagne |
| PH-03 | Coral and burgundy flower centrepiece | None | Reference B | `e2875ec08040e9bb` | `b86e101eb854048e3dd7759e8526f20f` | Gallery on Main and Tablet |
| PH-04 | Long table at golden hour | None | Reference B | `6097ef07a60ce20a` | `949cbf970de1d24cc3777a2d081821a4` | Gallery strip on Desktop-reply |
| PH-05 | Candelabra table facing the sea | None | Reference B | `d0e0253fe8703d91` | `2c0cad74665b5985bdc2c276298b4108` | Gallery on Main (wide) |
| PH-06 | Silk-draped table in a frescoed hall | None | Reference B | `6e58de05823ea74f` | `22744d53f4ac16cc376d6341bcef5918` | Gallery strip on Desktop-reply |
| PH-07 | Candles and dahlias on a white table | None | Reference B | `a1d54f28f57e7d78` | `9f52b40c8b2ffca059da69fc77a588c3` | Gallery on Main and Tablet |
| PH-08 | Folds of a white dress on marble | None | Reference B | `a10417cc6ac7c87e` | `f6a5296f65405b84ceaf832aeea18c06` | Gallery strip on Desktop-reply |
| PH-09 | Couple under a classical colonnade | A couple, faces small and in profile | Reference A | `f83a5b675432cf10` | `62ad8f15ad3e01bda7ddbaf052b12525` | Cover-full-bleed |

**Not placeholders:** the logo on the canvas (asset `4ca58a35adf69f699e0294fda7883c1c`) and in the
design system is Aveline's own supplied file, [`assets/aveline-events-logo.png`](assets/aveline-events-logo.png).

## What replaces them

| ID | Replacement needed | Ratio and minimum size |
|---|---|---|
| PH-01 | A cover photograph that reads as a celebration: a bouquet, hands, the couple from behind. The subject sits in the middle third so the arch crop keeps it | Portrait 4:5 or taller, at least 1600 × 2000 px |
| PH-02, PH-03, PH-07 | Detail photographs: flowers, hands, table settings | 4:5, at least 1600 × 2000 px |
| PH-04, PH-06 | Tables and venues | 4:5 or 3:2, at least 2000 px on the long side |
| PH-05 | A wide scene: a venue or a landscape | 3:2, at least 2400 × 1600 px |
| PH-08 | A quiet texture: fabric, paper, stone | 4:5, at least 1600 × 2000 px |
| PH-09 | A full-bleed portrait with calm space at the bottom for the names | 9:16 or 4:5, at least 1440 × 2560 px |

**Sources:**

- Aveline's own commissioned photography, or a library whose licence covers commercial use.
- **People shown need their consent** for marketing use.
- Who supplies them, and by when, is open (PQ-7).

## Before launch

- [ ] Every row above is replaced on the canvas, and the old upload is deleted from the canvas's
      asset store.
- [ ] No placeholder appears in the application, a template preview, a sample event or marketing
      material.
- [ ] This file is updated to say so, and then emptied or deleted.
- [ ] A line is added to `docs/GOING_LIVE.md` ("Mockup placeholder photographs replaced; see
      `frontend/docs/design/PLACEHOLDER_IMAGES.md`"). That file is shared, so the line goes in
      through the shared-document process, with the backend developer's review (setup proposal
      §4). This work did not edit it.
