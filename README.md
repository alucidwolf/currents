# Currents

A calm, procedurally generated ocean to drift through in the browser. Pick an
animal, then either steer it or leave it alone entirely — it swims and explores
on its own indefinitely, which makes it usable as a screensaver on a spare
monitor.

No score, no timer, no fail state.

## Running it

```sh
npm install
npm run dev      # http://127.0.0.1:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck, then production bundle into `dist/` |
| `npm run preview` | Serve the production bundle |
| `npm run typecheck` | Types only |
| `npm run verify:wander` | Headless check of the ambient wander (see below) |
| `npm run verify:reef` | Headless survey of how life is distributed on the seabed |
| `npm run verify:bodies` | Headless check that the animals are solid and face outward |

## Controls

| Input | Effect |
| --- | --- |
| **Left-drag** | Orbit the camera. It trails lazily through turns rather than snapping. |
| **Scroll** | Zoom in and out. |
| **Right-hold** | Steer: the animal curves toward your cursor. Release and it goes back to wandering on its own. |
| **Arrow keys** | Steer without the mouse — left and right turn, up and down climb and dive. Speed never changes; the keys only change where the animal is pointing. Let go and it levels off and goes back to wandering. |
| **H** | Toggle the control hints. |
| **F** | Toggle the stats overlay (fps, draw calls, chunk count, depth). |

The hints fade out on their own after a few seconds of stillness and come back
when you move the mouse.

The two ways of steering are different in kind. The cursor is *absolute* — it
names a point out in the water and the animal turns to face it. The keys are
*relative* — they say "keep turning this way". A key is also a step input, so
each axis is eased rather than read raw; otherwise a turn would go from nothing
to full rate in a single frame, which is exactly the jolt this is meant not to
have. The ease-out runs before control is handed back, so a turn unwinds instead
of being dropped mid-lean.

## URL options

| Fragment | Effect |
| --- | --- |
| `#ambient` | Skip the menu, pick an animal at random, start swimming. **This is the link to leave open on a second monitor.** |
| `#seed=abc123` | Rebuild a specific ocean exactly. The current seed is shown bottom-left. |
| `#species=manta` | Start as a named animal (`whale`, `turtle`, `manta`, `dolphin`), skipping the menu. |

Fragments combine: `#seed=reef7&species=manta`.

## Art direction

Smooth stylised, not faceted low-poly. Simple rounded forms, smooth shading,
and **bright saturated colour** — detail comes from silhouette and clean colour
blocking rather than from surface texture or polygon count.

Two rules earned the hard way:

**Brightness and saturation are different levers.** Piling on ambient light
makes everything lighter but drags every surface toward the ambient hue, so the
scene converges on one milky tint and all colour separation is lost. The look
comes from bright *base colours* under moderate light, not from more light.

**Don't mix a warm key with a cool ambient.** A warm sun against cyan ambient
puts the two lights on opposite sides of the colour wheel, and they average out
to grey on every surface. The key light is neutral and faintly cool.

Depth reads as *bluer*, never darker: the far distance is a saturated blue, not
black. Animals are countershaded with strongly contrasting values and carry one
graphic accent each — the humpback's white pectorals, the ray's dark wingtips —
in the way a seabird's dark primaries read against a pale body.

## How it works

Everything is generated in code — there are no model files, textures, or audio
assets anywhere in the project. The whole thing is Three.js and about 2,500
lines of TypeScript.

**The ocean is endless.** Seabed chunks are built from noise sampled in world
space, which means neighbouring chunks agree along their shared edges without
any stitching. Chunks stream in ahead of you and are recycled behind, so memory
stays flat no matter how long a session runs.

**The floor is not uniform.** Six noise layers stack up. Broad basins and
plateaus set the large shape; ordinary relief rolls over that; mid detail gives
the eye a sense of scale and a fine ripple is the sand texture up close. Then
two layers do the real work: *ridged* noise carved downward into winding
trenches, and a threshold layer raising occasional reef mounds.

**Life grows in colonies, not in a sprinkle.** Scattering props at random and
filtering them through a density field gives you more coral here and less there,
but every prop is still roughly as far from its neighbours as any other, and the
floor reads as litter. Real seabed is not like that — coral spreads outward from
a founding head, kelp grows in beds, loose rock collects in rubble fields. The
interesting structure is the clustering, not the density.

So placement happens in two stages. A colony field decides where clusters sit:
each one is an ellipse of ground with a kind, a shared palette and a member
list, packed toward its own heart and thinning at the rim, mostly of its own
kind but mixed at the edges. Roughly 70% of the eligible seabed ends up genuinely
open, and arriving at a reef feels like arriving somewhere.

Colonies are anchored to a cell but their members spill freely across chunk
borders, so a cluster is built half by each side. That only works because two
chunks generating the same colony must agree exactly: a colony is seeded from
its own cell, never from the chunk doing the asking, and is culled by bounding
box *before* any member is drawn from its generator rather than after.

**And there are structures to swim around.** Fertile reefs grow a large anchor —
a stacked coral head, a table coral, a cluster of pillars, or a hollow barrel
sponge standing several metres off the floor. Everything else down here tops out
around waist height on a swimming whale, which is why the seabed felt flat no
matter how much was scattered on it: a scene needs something to swim *over*, not
only past. One turns up roughly every eighty metres of seabed.

**There are wrecks.** Roughly one per quarter square kilometre, a ship lies
broken in two on the seabed, its halves settled at different angles with a gap
of open sand between them. They are deliberately rare — an endlessly generated
world where everywhere is equally interesting ends up feeling like nowhere is.
The autopilot rates them above coral and fish as somewhere to drift past.

**Nothing simulates water.** The sense of being underwater comes from five
cheap effects sharing one slowly rotating current vector: depth-tinted
exponential fog, procedural caustics on the seabed, kelp that leans on the
current, drifting particulate, and a shimmering surface overhead. Because they
all read the same vector, everything loose in view agrees about which way the
water is moving.

**Nothing is rigged.** Each animal's body is deformed by a travelling sine wave
injected into the vertex shader, weighted so the nose barely moves and the tail
moves most, with vertex normals rotated analytically to match the bend. Four
animals with distinct swimming styles, no bones, no skinning.

**Bodies are countershaded** — dark above, pale below — via a baked colour
attribute keyed to which way each surface faces. That keeps them readable from
any angle instead of collapsing into silhouette against open water.

**Bodies are closed, and that is load-bearing.** Back faces are culled, so a
hole in an animal is not a missing patch of skin — it is a window. Through it
you see the far wall's inside, whose faces point away from you and are
discarded, and so you see straight out the other side. Every body here comes
from a profile callback, which makes "does it close" a property of a function's
limit rather than of anything visible in the shape: a tail tapering to a
plausible peduncle instead of to a mathematical point leaves a hole, and looks
entirely correct from every angle except the one that points into it.

Winding matters for the same reason and hides even better. An inside-out body
still draws a correct silhouette out of the far wall's interior, and since
vertex colours travel with position, roughly the right colours too — it loses
its form without ever looking broken. Mirrored parts are the specific trap,
because mirroring reverses winding, so a builder taking a left/right parameter
gets one side right and the other exactly backwards.

Neither is judged by eye. Parts are mirrored as a whole rather than by negating
a coordinate, every closed part asserts its own orientation after construction
via its signed volume, and `npm run verify:bodies` checks each shared builder
and each finished animal for open edges and for facing the right way.

**Draw calls stay flat.** All of a chunk's coral, rock and kelp merge into a
single geometry, so a whole reef is one draw call; every fish in the world
shares one instanced mesh.

## The wander, and why it is tested

Left alone, the animal is always under autopilot — holding the right mouse
button or an arrow key suppresses it, releasing restores it. Four influences
combine:

1. **Meander** — smooth noise, for organic curves instead of straight lines.
2. **Anti-circling** — a fading memory of recent positions pushes it away from
   where it has just been. Noise steering alone drifts into lazy orbits over
   one patch of seabed; this is what turns orbiting back into exploring.
3. **Avoidance** — it reads the seabed ahead and arcs over ridges early, rather
   than pulling up at the last metre.
4. **Curiosity** — a weak pull toward coral and fish schools, so it drifts past
   scenery rather than empty water.

That behaviour only reveals itself over tens of minutes, which is impractical to
verify by watching. `npm run verify:wander` simulates it headlessly instead —
the real `Wander` and `Swimmer` over the real terrain, five seeds, twenty
simulated minutes each — and asserts that it never stalls, never touches the
seabed or surface, covers enough distinct ground to rule out circling, never
loiters in one place, and ends up somewhere genuinely else.

## The reef, and why it is also tested

Clustering has a failure mode that screenshots cannot catch. One view shows you
one reef and tells you nothing about the rest of the ocean, and colonies that are
too small, too frequent or too evenly spaced all look perfectly fine close up and
wrong from above. The difference between *clustered* and *sprinkled* is a
statistic, not a picture.

`npm run verify:reef` walks about 2.4 km² of seabed per seed, builds the real
decor, and reports the distribution: colonies per chunk, how often a large
structure appears, and — the number that actually distinguishes the two — what
share of usable ground has no prop within twelve metres. An even scatter at the
same overall density leaves almost nowhere far from something; clustering
concentrates the same props and opens real space between them.

It guards both ends. Too few colonies and the ocean reads as empty; too many and
they merge back into the sprinkle they replaced. It also caps the triangles in
the heaviest chunk, because where the fertility field peaks three or four
colonies can land on the same ground, and that chunk is what sets the worst frame
the streaming budget ever has to absorb.

## Performance

Pixel ratio is capped at 1.5, there are no shadow maps and no post-processing,
draw distance is bounded by the fog, and rendering suspends entirely while the
tab is hidden.

Measured on a 100Hz display while actively streaming terrain: **every frame in
a 25-second window hit vsync**, worst frame 10.3ms, with ~480k triangles across
~67 draw calls and a flat heap.

Getting there took two rounds of measurement, and the first assumption was
wrong. Chunk streaming was the only source of dropped frames, but not for the
reason expected — the terrain mesh costs about 1.2ms to build, while *decor*
cost 22ms, because every coral, rock and kelp was being constructed from
scratch for every chunk. Props are now built once into a shared library and
reused with per-placement scale, rotation and tint, which took decor to under
6ms. Chunk work is additionally split into a terrain pass and a decor pass
under a 5ms-per-frame time budget, so no single unit of work can blow a frame.

Moving to colonies made the seabed cheaper as well as better. Clustered life
needs fewer props than an even scatter to read as dense, and the survey showed
where the geometry was actually going — a coral clump is a dozen tapered tubes,
so the vertex count of one branch mattered far more than its silhouette at the
distance one is ever seen from. Decor now costs about 4,000 triangles per chunk
against roughly 12,000 before, with the heaviest chunk across five seeds at
20,000 — and that is with the large structures added.

Press **F** to watch it live. Draw calls should stay roughly constant as you
swim rather than climbing with distance travelled, and the live chunk count
should plateau rather than growing.

> Note that framerate cannot be measured while the tab is unfocused — the
> rendering loop deliberately suspends itself, so `requestAnimationFrame` never
> fires and any in-page sampler will simply hang.

## Layout

```
src/
  core/        seeded RNG, frame loop, and every tunable in config.ts
  control/     pointer input, camera rig
  creatures/   body construction, swim shader, the player animal, the autopilot
  world/       terrain, chunk streaming, decor, water, caustics, fish, motes
  ui/          start screen and HUD
tools/         headless wander verification
```

Start with `src/core/config.ts` — if a number matters, it lives there.
