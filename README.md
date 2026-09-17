# Currents

A calm, procedurally generated ocean to drift through in the browser. It starts
swimming the moment it loads — nothing to click through first — and you can
change animal mid-swim, steer, or leave it alone entirely. Left alone it
explores on its own indefinitely, which makes it usable as a screensaver on a
spare monitor.

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
| `npm run verify:steering` | Headless check that each control goes the way it looks, and that the camera stays in the water |

## Controls

| Input | Effect |
| --- | --- |
| **Left-hold and drag** | Orbit the camera. The camera lives behind the animal; moved, it stays where you put it and turns with the animal. It trails lazily through turns rather than snapping, and stays above the seabed and under the surface however far you swing it. |
| **Scroll** | Zoom in and out. |
| **Right-hold** | Steer: the animal curves toward your cursor. Release and it goes back to wandering on its own. Pressing the right button also swings the camera back behind the animal straight away — even a quick click, which does not steer. |
| **Arrow keys** | Steer without the mouse — left and right turn, up and down climb and dive. Speed never changes; the keys only change where the animal is pointing. Let go and it levels off and goes back to wandering. |
| **Swimming as…** | The button bottom-centre opens the animal picker. The ocean keeps moving behind it, and choosing is instant — position, heading and speed all carry over, so the new animal picks up exactly where the last one was. |
| **1**–**4**, **Tab** | The same thing without opening anything. Numbers pick one outright, Tab walks the list (Shift+Tab backwards). |
| **Sound on**, volume | The pill bottom-right. Sound starts on your first click or key, because browsers allow nothing before one, and fades in over a few seconds. |
| **M** | Sound on and off. |
| **N** | A new ocean. Different seed, different animal. |
| **H** | Toggle the control hints. |
| **F** | Toggle the stats overlay (fps, draw calls, chunk count, depth, time of day). |
| **P** | Toggle the diorama pass — depth of field, grade and vignette — to compare, or to claw back frame time. |

Both mouse gestures are holds. A button does nothing until it has been down for
a fifth of a second (`POINTER.holdDelay`), so a plain click, left or right,
never moves the camera or turns the animal.

The hints fade out on their own after a few seconds of stillness and come back
when you move the mouse.

The two ways of steering are different in kind. The cursor is *absolute* — it
names a point out in the water and the animal turns to face it. The keys are
*relative* — they say "keep turning this way". A key is also a step input, so
each axis is eased rather than read raw; otherwise a turn would go from nothing
to full rate in a single frame, which is exactly the jolt this is meant not to
have. The ease-out runs before control is handed back, so a turn unwinds instead
of being dropped mid-lean.

Left and right shipped inverted, and the reason is worth keeping. The change was
checked by holding right and watching the yaw number go up, which it did — but
nobody asked what a larger yaw does on screen. `forward` is
`(sin yaw, ·, cos yaw)`, so a larger yaw swings toward +X, while screen right is
`cross(forward, up)`, which is −X. Larger yaw turns the animal *left*. The
cursor never had this problem because it derives its heading from a world
direction, so it is correct by construction whichever way the signs run.

`npm run verify:steering` now presses each key, steps the real swimmer, and asks
which way the animal moved relative to where the screen's right and up were
pointing — deliberately never looking at yaw, because yaw is the number that
lied. It also checks left and right mirror each other, since two keys drifting
the same way would otherwise pass. Run against the old sign it reports right
arrow carrying the animal 12.4 metres to the *left*.

## URL options

| Fragment | Effect |
| --- | --- |
| `#ambient` | Start with no overlay at all — no title card, and the hints already faded. **This is the link to leave open on a second monitor.** |
| `#seed=abc123` | Rebuild a specific ocean exactly. The current seed is shown bottom-left, and is always written into the address, so a copied link is this ocean. |
| `#species=manta` | Start as a named animal (`whale`, `turtle`, `manta`, `dolphin`) rather than a random one. Swapping animals in game rewrites this, so a reload keeps whichever one you are currently being. |
| `#time=dusk` | Open at a time of day: `night`, `dawn`, `sunrise`, `morning`, `noon`, `sunset`, `dusk`, or an hour on a 24-hour clock such as `time=18.5`. Read once when the page opens and then removed from the address, so a later reload carries on from wherever the clock has got to. |

Fragments combine: `#seed=reef7&species=manta&time=sunset`.

## Time of day

A whole day passes in twenty minutes (`DAY.length`), so one sitting sees all of
it: a bright middle of the day, a warm sunset, dusk going violet, a moonlit night
where the specks drifting in the water glow, and a gold sunrise. The clock is
the time on the stats overlay (**F**).

The middle of the day — from mid-morning to mid-afternoon — *is* the approved
look, unchanged. Its values are read straight from the `WATER` settings rather
than copied, and `npm run verify:day` fails if any of them drift, so the day
cycle adds times of day around that look instead of replacing it.

Everything that lights the water takes one sample of the clock each frame
(`src/world/dayCycle.ts`): the water tint and fog, the ceiling's window, the sun,
ambient and fill lights, the light shafts, the caustics on the seabed, the warm
side of the diorama grade, and the glow of the specks. The look lives in
`DAY.keys` in the config as a handful of moments, and the rest of the day is an
eased blend between them, so no moment of the day is a visible corner. The day
check samples the whole cycle, across midnight too, and fails on any jump.

Two rules carried over from the tuning of the daytime look decide how the other
times are coloured:

- **Night is deeper blue, never black or grey.** Darkness underwater should read
  like depth does. The moonlight left is cool and comes from above, and the
  glowing specks become the brightest thing in the water.
- **Sunrise and sunset are warm light on blue water, not warm water.** Gold
  light mixed into teal water averages to grey, and the first attempt at these
  looked like a tired noon for exactly that reason. The water leans slightly
  bluer than by day instead, and the warmth is carried by the grade, the shafts
  and the caustics — the light on the sand.

The sun also moves: east at sunrise, overhead at noon, west at sunset, so the
animal's shadow leans in the low light.

## Remembering where you were

Close the tab, come back tomorrow, and the swim carries on: the same ocean, the
same animal, in the same place, heading the same way, at the same time of day,
with the camera framed the way you left it. A resumed swim does not replay the
logo. Sound on or off and the volume are remembered too, and those carry across
every ocean.

The swim belongs to one ocean. Opening a link to a different seed starts that
ocean from the beginning, and from then on it is the one remembered. **N**
forgets the swim on purpose, so a new ocean really is new.

The swim is saved every fifteen seconds, and whenever the tab is closed,
reloaded or put in the background. What comes back out of storage is not
trusted: a private window, a full or blocked disk, or a record from an older
version all count as a first visit, and every field is checked before any of it
is used, because one bad number read back as a position would put the animal
nowhere. `npm run verify:memory` feeds it every kind of broken record it can
think of (`src/core/memory.ts`).

## Sound

Everything you hear is synthesised in the browser from two noise buffers and a
handful of oscillators — there are no audio files (`src/audio/soundscape.ts`).

- A **deep hum** that gets darker and a little louder the deeper you go, and
  swells slowly, like a long wave passing overhead.
- A **surface wash**, a brighter hiss that only comes in over the top few metres.
- A **glide**, the water moving past the body, which rises when the animal turns.
- **Bubbles** now and then, in small clusters.
- Rarely, a long low **call** from somewhere out in the fog, mostly echo.
- Two soft notes when you change animal.

All of it passes through one low-pass filter on the way out. Water takes the top
off every sound in it, and that one filter does more to put you underwater than
any of the layers does on its own. The noise loops are crossfaded at their ends
so the hum never thumps where the buffer repeats, and sound stops while the tab
is hidden.

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
run, and until then the browser paints a white unstyled page. And a stylesheet
link would not help a *new ocean* either, because the gap there is between two
documents, before the new one has asked for any file at all. Inline styles and no external assets are what make the first
paint correct with nothing loaded.

It comes down once there is genuinely something behind it: shaders are compiled
up front with `renderer.compile`, because Three otherwise builds each material's
program the first time it is rendered and that stall lands on the very first
frame anyone sees. Then two animation frames pass — the first can still be slow,
and waiting for the second means what gets revealed is a world already running.
A timeout takes the screen down regardless after eight seconds, since a stuck
loading screen is far worse than an early one.

A new ocean raises the same screen **before** navigating, waits a frame for it to
paint, and only then reloads. Both ends of the navigation now show the same
gradient, so there is no seam across it.

## Deploying to GitHub Pages

Pushing to `main` builds and publishes the site. The workflow is
`.github/workflows/deploy.yml`, and it runs all four headless checks before it
publishes anything — the build passing is not on its own a reason to deploy.

**One setting has to be changed by hand**, once:

> **Settings → Pages → Build and deployment → Source**: change *Deploy from a
> branch* to **GitHub Actions**.

Until that is switched over, the workflow runs green and the deploy step fails
with a 404 from the Pages API, which is a confusing way to be told about a
dropdown. Then push to `main`, watch the run in **Actions**, and the site appears
at `https://<owner>.github.io/<repo>/`.

Worth knowing:

- **A free plan only serves Pages from a public repository.** On a private one
  the workflow succeeds and the site 404s. Pro and above can publish privately.
- **Actions must be enabled** — *Settings → Actions → General → Allow all
  actions and reusable workflows*.
- **The first deploy may wait for approval.** Publishing uses a `github-pages`
  environment, which GitHub creates on the first run; if it has protection rules
  the job pauses until someone approves it.
- If the deploy step fails on permissions, check *Settings → Actions → General →
  Workflow permissions*. The workflow asks for what it needs explicitly, so this
  normally does not matter, but an organisation policy can override it.
- **A custom domain needs no change here.** The base path comes from what the
  Pages API reports, so adding one moves the site to the root and the next
  build follows it.

### The base path is the thing that breaks

A project site is served from `/<repo>/`, not from `/`. Everything this page
references is root-relative, so built with the wrong base every asset 404s and
you get a blank screen with nothing in the console that names the cause.

`vite.config.ts` derives the base rather than hardcoding it: the workflow passes
what the Pages API reports, falling back to the repository name from the
environment, falling back to `/` locally. A written-down `/currents/` would break
quietly the moment the repository was renamed or forked.

To check a production build the way it will actually be served:

```sh
BASE_PATH=/currents npm run build && npx vite preview --port 4173
# then open http://localhost:4173/currents/
```

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
  audio/       the synthesised soundscape
  core/        seeded RNG, frame loop, what the page remembers, and every tunable in config.ts
  control/     pointer input, camera rig
  creatures/   body construction, swim shader, the player animal, the autopilot
  render/      the diorama pass: depth of field, grade, vignette
  world/       terrain, chunk streaming, decor, water, caustics, fish, motes
  ui/          HUD, title card, sound control, and what the URL asks for
tools/         headless checks: bodies, steering, reef, wander, memory, day
```

Start with `src/core/config.ts` — if a number matters, it lives there.
