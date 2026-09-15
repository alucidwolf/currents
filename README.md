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
| **1**–**4**, **Tab** | Swap animal mid-swim. Numbers pick one outright, Tab walks the list (Shift+Tab backwards). Position, heading and speed all carry over, so the new animal picks up exactly where the last one was. |
| **H** | Toggle the control hints. |
| **F** | Toggle the stats overlay (fps, draw calls, chunk count, depth). |
| **P** | Toggle the diorama pass — depth of field, grade and vignette — to compare, or to claw back frame time. |

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
| `#species=manta` | Start as a named animal (`whale`, `turtle`, `manta`, `dolphin`), skipping the menu. Swapping animals in game rewrites this, so a reload keeps whichever one you are currently being. |

Fragments combine: `#seed=reef7&species=manta`.

## Art direction

Smooth stylised, not faceted low-poly. Simple rounded forms, smooth shading,
and **bright saturated colour** — detail comes from silhouette and clean colour
blocking rather than from surface texture or polygon count.

**The target is a cosy tabletop diorama**, after TUNIC. The thing that produces
that reading is not the models — chunky low-poly forms on their own just look
like chunky low-poly forms — it is a **shallow depth of field**, the same trick
that makes a tilt-shift photograph of a real street look like a toy. Focus
follows the animal, so it stays crisp wherever the camera orbits while the water
in front and the reef behind go soft. Underwater that is also the honest thing
to do, since scattering really does soften distance.

Three things support it. The animal casts a single soft shadow onto whatever is
beneath it — anything that casts nothing floats, however well it is lit, and a
shadow tracking across the seabed is most of what gives a large animal weight.
A warm-highlight, cool-shadow split tone runs as a grade rather than as a warm
key light, because a warm lamp against this scene's cool ambient averages to
grey on every surface; applied after lighting the two pull apart instead. And
the corners fall off, which frames the view as an object being looked at.

The camera sits a little above level for the same reason. The reference takes
this much further with a fixed isometric view, which is not open to a game about
following an animal, but the angle still helps.

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

## The loading screen

A gradient and one word, styled inline in `<head>` and sitting first in the
body. That is not laziness — it is the only way to cover the two gaps that
actually flash.

Everything else on the page arrives too late. The stylesheet is imported from
the entry module, so in development it is injected only once the JavaScript has
run, and until then the browser paints a white page with the menu markup stacked
up raw. And a stylesheet link would not help the *New ocean* reload either,
because the gap there is between two documents, before the new one has asked for
any file at all. Inline styles and no external assets are what make the first
paint correct with nothing loaded.

It comes down once there is genuinely something behind it: shaders are compiled
up front with `renderer.compile`, because Three otherwise builds each material's
program the first time it is rendered and that stall lands on the very first
frame anyone sees. Then two animation frames pass — the first can still be slow,
and waiting for the second means what gets revealed is a world already running.
A timeout takes the screen down regardless after eight seconds, since a stuck
loading screen is far worse than an early one.

*New ocean* raises the same screen **before** navigating, waits a frame for it to
paint, and only then reloads. Both ends of the navigation now show the same
gradient, so there is no seam across it.

## Brand assets

`brand/currents-logo.jpg` is the original artwork; everything in `public/` is
derived from it, so it is the file to replace if the logo ever changes. The
measurements needed to redo that, taken against the 1408×768 source:

| | |
| --- | --- |
| Background | `#F3F4EE`, with visible JPEG grain |
| Mark (ray, bubbles, swirls) | x 432–976, y 120–500 — exactly centred |
| Wordmark | x 408–1004, y 572–640 |

The square icons are composed around the mark's own centre rather than cropped,
because any square large enough to give the mark breathing room also reaches
down into the wordmark. They keep the cream field: it is the logo as drawn, and
a mark floating on transparency would take whatever colour the browser's tab
strip happened to be. The maskable icon holds the mark to 60% of the width so it
survives being cropped to a circle.

`logo-mark.png` is the exception — the cream lifted out, for use inside the app
where the background is near-black. Two things that a plain colour key gets
wrong: the grain across the cream clears any threshold low enough to preserve
the pale swirls, leaving a speckled rectangle floating behind the artwork, so
only background *connected to the border* is a candidate for removal. And every
antialiased edge is part cream, so partly-transparent pixels have it unmixed
back out — `fg = (observed − (1−a)·bg) / a` — which is the difference between a
clean edge and a pale fringe around everything.

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

**The ceiling and the distance are different things.** They did not used to be:
`scene.background` can only hold one colour and fog fades everything toward one
colour, so the surface above and the emptiness ahead were literally the same
pixels and the horizon had no position. Two things separate them now.

The open water is a vertical gradient on a large sphere rather than a flat tint.
It passes exactly through the fog colour at eye level, so distance still
dissolves into it with no seam, and departs from it above and below — which is
what gives the horizon somewhere to be.

The surface uses **Snell's window**. Underwater the ceiling is not one even
sheet: past about 48° from vertical the water total-internally reflects, so it
stops being a window onto the sky and becomes a mirror showing the depths back
at you. That bright disc overhead falling away to a dark mirrored lid is the
thing that reads as *a surface* rather than as more distance. The ripple is
applied to the angle rather than to the colour, so the edge of the window breaks
into moving scallops the way it actually does.

The surface also fades out with distance instead of ending. Any finite plane
that simply stops draws a line across the view where it does — the camera's far
plane cuts this one long before its own edge, and the graded water showing past
the cut is not the colour the fog has faded the ceiling to, so the two do not
meet. Fading it well inside the clip distance leaves no edge to see, and it is
what the surface does anyway: a bright lid overhead, lost in the murk toward the
horizon.

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

1. **Course** — a definite heading, held, and changed now and then by a decided
   turn. Mostly slight, occasionally sharp.
2. **Anti-circling** — a fading memory of recent positions pushes it away from
   where it has just been, and at the moment it picks a new course, tells it
   which way is unexplored.
3. **Avoidance** — it reads the seabed ahead and arcs over ridges early, rather
   than pulling up at the last metre.
4. **Curiosity** — a weak pull toward coral and fish schools, so it drifts past
   scenery rather than empty water.

**The course is held rather than wandered, and that distinction is the whole
thing.** The obvious way to write a meander is to offset the *current* heading
by smooth noise, which is what this did for a long time. It is wrong in a way
that is easy to miss: an offset from the current heading is a turn-*rate*
command, not a heading, so the animal keeps turning for as long as the noise
keeps its sign — and smooth noise holds a sign for tens of seconds. Watched for
a while, it curved one way for most of a minute, then the other way for about
as long.

Nothing that measures *where it went* catches that. Ground covered, distance
travelled and time spent loitering were all healthy, because a long sweeping arc
crosses plenty of fresh water. What it fails is the thing you actually notice,
which is the shape of the path. So the check now also measures turning itself:
what share of it went one way, and the longest unbroken stretch spent turning in
one direction. Replacing the noise meander with a held course cut that stretch
from 11–15 seconds to 4–7, and roughly doubled how far from home twenty minutes
gets — the worst case went from 930 metres to 4.7 kilometres.

Turn direction leans against however the animal has lately been turning, with a
memory that fades over a couple of minutes. Without that, a run of same-way
turns quietly reassembles the very thing the held course was meant to prevent.

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

Pixel ratio is capped at 1.5, draw distance is bounded by the fog, and rendering
suspends entirely while the tab is hidden. There is one shadow map, cast by the
animal alone into a small frustum that travels with it, and one post-processing
chain whose expensive pass runs at half resolution.

Measured on a 100Hz display while actively streaming terrain, *before* the
diorama pass and its shadow existed: **every frame in a 25-second window hit
vsync**, worst frame 10.3ms, with ~480k triangles across ~67 draw calls and a
flat heap. Decor has since got about three times lighter, and the diorama pass
adds three fullscreen draws — two of them at quarter the pixels — plus a
1024² depth render of one animal. That has not been re-measured.

Press **P** to toggle the diorama pass. It is the only part of the renderer
whose cost scales with screen area rather than with what is in the scene, so it
is the first thing to turn off on a machine that is struggling.

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
  render/      the diorama pass: depth of field, grade, vignette
  world/       terrain, chunk streaming, decor, water, caustics, fish, motes
  ui/          start screen and HUD
tools/         headless wander verification
```

Start with `src/core/config.ts` — if a number matters, it lives there.
