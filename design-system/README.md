Currents is a calm ocean to drift through. This system gives its interface the look of a cosy tabletop diorama: small faceted blocks, warm sunlight and moss green on blue water, and the cream paper of a game manual. The direction is inspired by TUNIC. The repo's own art direction already names TUNIC as its reference for the 3D scene. This system carries the look into the HUD and menus, and the **Creatures & world** section carries the hero's character design into the water, the animals and the seabed: faceted surfaces, toy proportions, dot eyes and four-part colour blocking.

It is inspired by TUNIC, not a copy of it. Never use TUNIC's logo, fox, glyph alphabet, screenshots or illustrations. The only marks are Currents' own, under `assets/Logos/`.

## Principles

- **Faceted, never rounded.** Every control is a chamfered octagon (a `cu-facet`), with corners cut at a `bevel-*` token. Replace every `border-radius: 999px` pill and rounded card from the old `styles.css` with a facet. The `radius-*` tokens are kept only as a record of the source.
- **Blocks that sit on the table.** A facet has a 1px `edge-solid` outline, a solid or `glass` face, a lit 3px `panel-hi` band on top and a 4px `panel-lo` lip underneath. The lip is what makes it read as a chunky toy piece. Never replace it with a drop shadow.
- **Bright base colours, moderate light.** This rule applies to the UI as well as the scene. Get colour from `leaf`, `sun`, `coral` and `accent-sea` at full value, in small doses, on `deep` or `panel`. Don't brighten or wash out surfaces to make them feel friendly.
- **Warm light on blue water, not warm water.** Warmth (`sun`, `coral`) is carried by small highlights, focus rings and marks. Grounds and faces stay blue, or cream on paper.
- **The ocean never stops.** Overlays are light and translucent and close on almost anything. Nothing is a gate. Keep every source rule about fades and `pointer-events`.

## Themes

- `deep` is the in-app theme, over the live 3D ocean. It is the default, and `color-scheme: dark` stays.
- `paper` is the storybook manual: cream `deep` (the logo's `#F3F4EE`) and navy `ink` (the logo's wordmark). Use it for pages that read as printed matter, like an About or How-to-play screen, a press kit or the OG card. Don't use it for the HUD over water.

## Colour usage

- Put text in `ink` on `deep`, `glass` or `panel`, and secondary text in `ink-dim`. Never set text on the `panel-hi` band.
- `leaf` means *this one / chosen / go*: the current animal and the trigger icon. For text on a leaf fill, use `on-leaf`.
- `sun` is the focus ring (solid, 2px, offset 3px) and the keycap letters. A focused facet turns its outline `sun`, because a clipped tile can't show an outside outline.
- In the deep theme, `coral` and `violet` are for marks only (at least 3:1). Don't use them for body text.
- The `world-*`, `coral-*` and `kelp-*` tokens are the scene's exact values from `src/core/config.ts` and `src/world/*`. They are here so UI accents can match the scene (for example, `leaf` is `kelp-4` and `sun` is `world-sand`). Change them in the code, not here.

## Type

- Set display text in `display` (Fredoka): the title word, dialog titles, the announce text and card names. Use uppercase with wide tracking, as the source does (0.14–0.18em).
- Set everything else in `sans` (Nunito). Its rounded terminals suit the soft, chunky facets. Use `mono` for the stats overlay only.
- Load both from Google Fonts, but never in the inline boot screen. `index.html`'s `#boot` stays on `system` with no fonts or images, so the first paint is right with nothing loaded.
- Use the sizes on the styles (`title-word` down to `caption`). They are the source's exact rem values.

## Spacing and shape

- Use the spacing steps `space-1`–`space-6` (0.3rem–1.6rem), taken from the source's paddings and gaps. Keep the HUD inset at `clamp(0.9rem, 2.5vw, 1.6rem)`.
- Bevels: `bevel-xs` for keycaps, `bevel-sm` for the stats panel, `bevel-md` for the trigger, cards and buttons, and `bevel-lg` for dialogs.
- Decorative shapes are cut too: the diamond sound pip and the trapezoid rules under the announce text and title. Use no circles, apart from bubbles in the logo art.

## Motion

Keep the source timings. Hover lifts are 2px on the trigger and 3px on cards over 0.25s. The picker fades in over 0.24s and rises 0.6rem over 0.28s. The announce text snaps in over 0.14s and drifts out over 0.9s. The HUD fades over 1.6s. Honour `prefers-reduced-motion`.

## Voice

Calm, dry and short. Lowercase for controls ("sound on", "to look around"). Uppercase and tracked for names and titles ("BE SOMETHING ELSE", "MANTA RAY"). Species blurbs are one short, wry line ("Turns like a continent."). There's no score, urgency or exclamation marks, and no emoji.

## Iconography

There is no icon set. Icons are silhouettes built with `clip-path` polygons, filled with a token: the ray on the trigger, the diamond pip. Add new ones the same way, as flat, low-poly and single-colour shapes. Logos are in `assets/Logos/`, and on `deep` the only one to use is `logo-mark.png`.

## Applying this to the repo

- `src/styles.css`: keep the `:root` variable names (`--ink`, `--ink-dim`, `--deep`, `--glass`, `--edge`) and add the new tokens beside them. Then move each block onto its component: `.animal-trigger` → `AnimalTrigger`, `.sound` → `SoundControl`, `.picker__panel` → `Panel`, `.picker__card` → `PickerCard`, `.stats` → `StatsPanel`, `.announce` → `Announce`, `.title-card` → `TitleCard`, and the `.hud__hints b` keys → `Keycap`. `bundle.css` is a working reference implementation (`cu-*` classes).
- `index.html` and the `src/ui/*.ts` files build this markup. Keep every id, `aria-*` attribute and `data-*` state hook as they are, and change only the classes and inner structure.
- For the 3D scene, follow **Creatures & world**. It uses the `form` tokens and the `creature-*` and per-animal colours. The `world-*` water and light colours stay exactly as they are.

## Not synced

This system was built from `alucidwolf/currents` at `main@f897615`. Some parts are authored rather than copied from the code:

- **Taken exactly from the code:** the colours in `styles.css` and `index.html`, the world palette, the type sizes, the spacing and radii, the shadows and the logos.
- **Authored as a TUNIC-inspired direction:** the `paper` theme's values, the `panel*`, `edge-solid`, `leaf`, `sun`, `coral` and `violet` tokens, and the `bevel` family. In 3D, the `form` family, `creature-belly`, the `*-tip` colours and the whole Creatures & world section are authored too. The back, shell, plastron, flipper and eye colours are exact from `species.ts`. The `display` and `sans` faces are a proposal, since the repo uses system fonts. They are hosted on Google Fonts, so there are no font files.
- **Components:** the repo has no component library, so these are static, hand-written from `src/styles.css` and `index.html`. The previews render `components/bundle.css` markup.
- **Not brought in:** the favicon sizes, `og-image.jpg`, and the boot screen, which stays inline and system-font on purpose.
