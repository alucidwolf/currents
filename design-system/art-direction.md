# Creatures & world

These are the 3D rules for the water, the animals, the fish, the seabed and the props. They carry the character-design language of TUNIC's fox hero into Currents' own sea animals. Take the principles, never the character: don't model a fox, don't put clothes, weapons or accessories on the animals, and don't use TUNIC's glyphs anywhere in the scene.

This direction **replaces two rules in the repo's README**. "Smooth stylised, not faceted low-poly" becomes *faceted and toy-like*. "Recognisable anatomy" becomes *recognisable silhouette*. All of the repo's other art rules still hold: the diorama pass, the single soft shadow, bright base colours under moderate light, a neutral key light, and depth that reads bluer rather than darker.

## What the fox teaches

Read the hero as a set of transferable moves:

1. **Toy proportions.** The head and forebody are oversized, the limbs short and stubby, and the whole figure compact. It reads as a figurine you could pick up.
2. **One signature shape, exaggerated.** The fox's ears carry the whole silhouette. Every Currents animal gets exactly one of these and keeps it at full size while everything else shrinks.
3. **Dot eyes, no other face.** Small, solid, dark eyes set high and forward. There are no pupils, catchlights, brows or mouth lines. The eyes do all the expression.
4. **Four-part colour blocking.** A saturated body colour, a warm cream underside, darker tips on the extremities, and one bold accent. Each is a clean, hard-edged area of flat colour, with no gradients, texture or noise.
5. **Visible, chunky facets.** Surfaces are low-poly and flat-shaded, so each polygon is one clean plane of colour. The facets are large enough to count on the body.
6. **Soft light on hard shapes.** The lighting is gentle and the shadows are soft. The low-poly crispness comes from geometry, never from harsh light.

## Animals

The same recipe applies to all four animals. Numbers are in the `form` tokens.

- **Geometry.** Swept bodies use `body-radial` × `body-segments`. Foils and flukes use `fin-chord`, and eyes are `eye-segments` beads.
- **Proportions.** Shorten bodies by `body-length-scale` while keeping their height, bulk the front third by `head-scale`, and shrink secondary fins by `limb-scale`. Scale `viewDistance` with length.
- **Eyes.** Multiply every eye radius by `eye-scale` and nudge the pair up and forward. Eyes stay `creature-eye`.
- **Colour.** Every animal's colour is a *back*, the shared `creature-belly`, a *tip* and one *accent*.

| Animal | Signature shape (keep full size) | Back | Tip (whole facets) | Accent |
| --- | --- | --- | --- | --- |
| Humpback Whale | Long pale pectorals | `whale-back` | `whale-tip` on the fluke edge, hump and rostrum knobs (3–4 big knobs, not many small ones) | `whale-accent` pectorals |
| Dolphin | Round melon and short beak | `dolphin-back`, with the cape at 0.66× | `dolphin-tip` on the dorsal fin, fluke and beak tip | The cape band |
| Manta Ray | Full wingspan (`span` stays 9.4) | `manta-back` | `manta-tip` on the outer fifth of each wing as a hard band | Stubby, rounded cephalic fins |
| Sea Turtle | High, domed shell | `turtle-shell` | `turtle-tip` scute seams and flipper tips | `turtle-plastron` underside |

The turtle's shell should be a low-poly dome where **each scute is a group of facets**, not a smooth shell with painted seams.

## Implementing facets in this codebase

- **Flat shading.** In `createSwimMaterial` (`src/creatures/swimShader.ts`), make `flatShading` default to `true`, and update the comment beside it. Also set it on the turtle's flipper material, the fish, the decor material and the terrain. Three.js derives flat normals per fragment from screen derivatives, so it keeps working while the swim shader deforms vertices.
- **Per-face colour.** Vertex colours still blend across a triangle, which blurs the countershade line. After `applyCountershading`, `overlayPattern` and `attachDetails`, convert with `toNonIndexed()`. Then give each triangle the colour sampled at its centroid, or the majority colour of its three vertices, on all three vertices. The countershade line then becomes a stepped facet edge, which is the intended look.
- **Hard pattern edges.** Tighten the `smooth(...)` ranges inside the overlay patterns (pectorals, wingtips, cape), or replace them with a step, so each marking covers whole faces.
- **Keep the checks green.** Run `npm run verify:bodies` after every geometry change: bodies must stay solid and face outward at the lower counts. Run `verify:steering` and `verify:wander` after changing length or `viewDistance`.

## Fish

Fish are tiny chunky wedges with 4–6 faces on the body and a single-triangle tail, flat-shaded. Keep the source `fish` gold as the body. They are the warm confetti of the scene, so keep them bright.

## Seabed

- Set `WORLD.chunkRes` to `terrain-res` and flat-shade the terrain, so the floor reads as big tilted planes, like a papercraft diorama.
- **Colour by bands, not a ramp.** Quantise the elevation colour into 3–4 hard bands: `world-sand` → `world-silt` → `world-deep-silt`, with `world-rock` on steep faces. Each face takes one band, plus `face-jitter` of lightness so neighbouring planes separate.
- Chunk edges stay seamless, because heights are still sampled in world space. Apply the per-face jitter from a hash of the face's world position, not its index, so neighbouring chunks agree.

## Props and landmarks

- **Rocks:** `IcosahedronGeometry(r, rock-detail)`, squashed and rotated at random so every boulder is a different chunky gem.
- **Coral lobes and domes:** `prop-sphere` × 5 segments. Fans become 3×3 planes and table corals 8-sided cylinders. Use flat colours from `coral-1` to `coral-6`, one per colony member, with no gradient.
- **Kelp:** 1×4 ribbon segments with flat facets, so the lean on the current bends in visible steps. Use colours from `kelp-1` to `kelp-5`.
- **Barrel sponges and pillars:** 7-sided lathes.
- **Wrecks:** these already use boxes. Chamfer the long hull edges so each wreck reads as a toy boat, and keep the source hull and rust colours.
- Colonies keep their clustering rules. Only the forms change.

## Water and light

- Keep every `WATER` and `DAY` colour exactly as it is. `npm run verify:day` guards the approved noon look, and the palette is already the right saturated blue.
- **Surface:** facet the ceiling. Replace the 1×1 surface plane with a coarse triangulated grid whose vertices bob gently, flat-shaded, so Snell's window shimmers as moving planes of light.
- **Caustics:** use fewer, larger, blockier cells. Quantise the caustic intensity to 3 levels, so the light on the sand looks like cut paper, not fine noise.
- **Light shafts:** keep three uneven shafts, but give them crisper edges (less blur) and make them a little wider.
- **Motes:** tiny octahedra or tetrahedra, not round points, and still glowing `mote-glow` at night.
- **Diorama pass:** keep it as it is. The shallow depth of field is already the tilt-shift trick that makes facets read as a miniature, and it matters more once the shapes are chunkier.

## Don'ts

- Don't add outlines or ink edges. The facets and the colour blocking separate the shapes.
- Don't add texture maps, normal maps or specular shine. Lambert with flat shading is the whole material model.
- Don't make faces expressive. There are no mouths, brows or blinking lids, only the dot eyes.
- Don't shrink the signature shape along with everything else, or the animal stops being identifiable.
- Don't raise the ambient light to make things feel friendly. Friendliness comes from proportion and colour.
