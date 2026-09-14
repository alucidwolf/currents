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

## Controls

| Input | Effect |
| --- | --- |
| **Left-drag** | Orbit the camera. It trails lazily through turns rather than snapping. |
| **Scroll** | Zoom in and out. |
| **Right-hold** | Steer: the animal curves toward your cursor. Release and it goes back to wandering on its own. |
| **H** | Toggle the control hints. |
| **F** | Toggle the stats overlay (fps, draw calls, chunk count, depth). |

The hints fade out on their own after a few seconds of stillness and come back
when you move the mouse.

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
trenches, and a threshold layer raising occasional reef mounds. A separate
reef-density field decides how thickly coral and kelp grow, so the world has
dense gardens and bare sand flats rather than an even sprinkle everywhere.

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

**Draw calls stay flat.** All of a chunk's coral, rock and kelp merge into a
single geometry, so a whole reef is one draw call; every fish in the world
shares one instanced mesh.

## The wander, and why it is tested

Left alone, the animal is always under autopilot — holding the right mouse
button suppresses it, releasing restores it. Four influences combine:

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
