import * as THREE from "three";
import "./styles.css";

import { Soundscape } from "./audio/soundscape";
import { CAMERA, RENDER, SWIM, WORLD } from "./core/config";
import { createLoop } from "./core/loop";
import { forgetSwim, readSettings, readSwim, writeSettings, writeSwim } from "./core/memory";
import { formatSeed, resolveWorldSeed } from "./core/rng";
import { CameraRig } from "./control/cameraRig";
import { createInput } from "./control/input";
import { keyboardCommand } from "./control/steering";
import { angleDelta, Swimmer } from "./creatures/swimmer";
import type { SteerCommand } from "./creatures/swimmer";
import { Wander } from "./creatures/wander";
import { SPECIES, speciesById } from "./creatures/species";
import type { CreatureRig, SpeciesDef } from "./creatures/species";
import { Diorama } from "./render/diorama";
import { makeCausticTerrainMaterial } from "./world/caustics";
import { ChunkManager } from "./world/chunks";
import { Current } from "./world/current";
import { makeDecorMaterial } from "./world/decor";
import { FishSchools } from "./world/fish";
import { LightShafts } from "./world/lightShafts";
import { Motes } from "./world/motes";
import { Terrain } from "./world/terrain";
import { Water } from "./world/water";
import { Hud } from "./ui/hud";
import { isAmbientMode, requestedSpecies } from "./ui/launch";
import { SoundControl } from "./ui/soundControl";
import { SpeciesPicker } from "./ui/speciesPicker";
import { TitleCard } from "./ui/titleCard";

const canvas = document.getElementById("scene") as HTMLCanvasElement;

// -- renderer ----------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
// Retina pixel counts buy very little on a low-poly scene and cost a lot of
// fill rate; capping keeps integrated GPUs comfortably at 60fps.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);

// One soft shadow, cast by the animal alone onto whatever is under it. Objects
// that cast nothing float, however well they are lit — and a shadow tracking
// across the seabed is most of what makes a big animal feel like it has weight.
// Confined to the animal because the reef is the expensive half of the scene
// and gains far less from it.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const diorama = new Diorama(renderer);
diorama.setSize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());

// -- world -------------------------------------------------------------------

// A remembered swim only counts in the ocean it was swum in. A link naming a
// different seed opens that ocean fresh, and leaves the remembered one alone.
const storedSwim = readSwim();
const worldSeed = resolveWorldSeed(location.hash, storedSwim?.seed ?? null);
const resumed = storedSwim?.seed === worldSeed ? storedSwim : null;
const terrain = new Terrain(worldSeed);
const water = new Water(scene);
const caustics = makeCausticTerrainMaterial();
const decor = makeDecorMaterial();
const chunks = new ChunkManager(
  scene,
  terrain,
  caustics.material,
  decor.material,
  worldSeed,
);
const current = new Current(worldSeed);

const swimmer = new Swimmer(terrain);
const wander = new Wander(terrain, worldSeed);
const rig = new CameraRig(window.innerWidth / window.innerHeight, terrain);
const input = createInput(canvas);
const hud = new Hud();
const titleCard = new TitleCard();
const picker = new SpeciesPicker(
  (chosen) => adoptSpecies(chosen, true),
  (owned) => input.setSteeringEnabled(!owned),
);

const settings = readSettings();
const sound = new Soundscape(settings.muted, settings.volume);
const soundControl = new SoundControl(sound, () =>
  writeSettings({ muted: sound.muted, volume: sound.volume }),
);

scene.add(swimmer.object);

if (resumed) {
  // Back where it was. The height is held inside the same bounds the swimmer
  // keeps itself to, in case the record came from a version of the seabed
  // that stood somewhere else.
  const floor = terrain.heightAt(resumed.x, resumed.z) + SWIM.seabedClearance;
  const ceiling = WORLD.surfaceY - SWIM.surfaceClearance;
  swimmer.position.set(resumed.x, Math.min(ceiling, Math.max(floor, resumed.y)), resumed.z);
  swimmer.yaw = resumed.yaw;
  swimmer.pitch = resumed.pitch;
  rig.restore(resumed.camera);
} else {
  // Drop the swimmer a sensible distance above whatever the seabed happens to
  // be doing at the origin of this particular world.
  swimmer.position.y = terrain.heightAt(0, 0) + 18;
}
swimmer.object.position.copy(swimmer.position);
chunks.primeAround(swimmer.position);

const fish = new FishSchools(scene, terrain, worldSeed, swimmer.position);
const motes = new Motes(scene, swimmer.position);
const shafts = new LightShafts(scene, worldSeed);

// Curiosity draws on both the static reef and the fish moving through it.
wander.setPoiProvider((near, radius, out) => {
  chunks.collectPointsOfInterest(near, radius, out);
  fish.collectPointsOfInterest(near, radius, out);
});

hud.setSeed(formatSeed(worldSeed));

// -- species selection -------------------------------------------------------

let creature: CreatureRig | null = null;
let species: SpeciesDef | null = null;

/**
 * Seconds a swapped-in animal takes to settle to full size.
 *
 * Only long enough to stop the change being a hard cut. Everything else about
 * the swimmer carries over untouched — position, heading, speed, the trail the
 * autopilot is steering by — so the new animal picks up exactly mid-stroke
 * where the old one was, and the swap reads as the same swim continuing.
 */
const SWAP_SETTLE = 0.42;
let swapSettle = 1;

/**
 * Keep the ocean and the current animal in the URL.
 *
 * The seed is written even when the link did not name one, so a copied address
 * is always this exact ocean.
 *
 * `replaceState` rather than assigning `location.hash`: assigning pushes a
 * history entry for every swap, so Back would walk you through each one instead
 * of leaving the page.
 */
function rememberSpecies(id: string): void {
  const parts = location.hash.replace(/^#/, "").split("&").filter(Boolean);
  const kept = parts.filter((part) => !/^(?:seed|species)=/i.test(part));
  kept.unshift(`seed=${formatSeed(worldSeed)}`);
  kept.push(`species=${id}`);
  history.replaceState(null, "", `#${kept.join("&")}`);
}

function adoptSpecies(chosen: SpeciesDef, announce = false): void {
  creature?.dispose();
  creature?.root.removeFromParent();

  species = chosen;
  creature = chosen.build();

  // The animal is the only thing in the world that casts a shadow, and it is
  // set here rather than inside each species because the species do not all
  // build the same way — a turtle is a shell plus four separately pivoted
  // flippers, so anything set once per rig would quietly miss most of it.
  creature.root.traverse((node) => {
    node.castShadow = true;
  });

  swimmer.object.add(creature.root);
  // A floor, not a reset — swapping animals should not throw away whatever the
  // player had zoomed to.
  rig.ensureRoomFor(chosen.viewDistance);
  rememberSpecies(chosen.id);
  // However the animal was changed — card, number key or Tab — the button and
  // the marked card follow it.
  picker.setCurrent(chosen);

  if (announce) {
    swapSettle = 0;
    hud.announce(chosen.name);
    sound.chime();
  }
}

/**
 * Swap animals mid-swim.
 *
 * Numbers pick one outright; Tab walks along the list for anyone who would
 * rather not remember which is which. Modified presses are left to the browser,
 * so Ctrl+Tab and friends still do what they always did.
 */
function bindSpeciesKeys(): void {
  window.addEventListener("keydown", (event) => {
    if (!species) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    // While the picker is open it owns the keyboard: Tab walks its cards and
    // the numbers would be fighting whatever has focus.
    if (picker.isOpen) return;

    if (event.key === "Tab") {
      event.preventDefault();
      const step = event.shiftKey ? -1 : 1;
      const next = (SPECIES.indexOf(species) + step + SPECIES.length) % SPECIES.length;
      adoptSpecies(SPECIES[next]!, true);
      return;
    }

    const pick = Number.parseInt(event.key, 10);
    if (pick >= 1 && pick <= SPECIES.length) {
      const chosen = SPECIES[pick - 1]!;
      if (chosen !== species) adoptSpecies(chosen, true);
    }
  });
}

bindSpeciesKeys();

// -- steering ----------------------------------------------------------------

const steerTarget = new THREE.Vector3();
const steerDirection = new THREE.Vector3();

/**
 * Turn the cursor into a heading.
 *
 * The cursor is unprojected to a point out in the water ahead of the camera,
 * and the animal is asked to face it. Steering therefore means "go over there"
 * rather than "rotate by this much", which is far easier to do gently.
 */
function playerCommand(): SteerCommand {
  steerTarget.set(input.ndcX, input.ndcY, 0.5).unproject(rig.camera);
  steerDirection.copy(steerTarget).sub(rig.camera.position).normalize();

  // Project out to a fixed distance so the turn rate does not depend on how
  // far away the geometry under the cursor happens to be.
  steerTarget.copy(rig.camera.position).addScaledVector(steerDirection, 70);
  steerDirection.copy(steerTarget).sub(swimmer.position);

  if (steerDirection.lengthSq() < 1e-6) {
    return { yaw: swimmer.yaw, pitch: swimmer.pitch, turnRate: 0 };
  }

  steerDirection.normalize();

  return {
    yaw: Math.atan2(steerDirection.x, steerDirection.z),
    // Clamped well short of vertical: nothing here should ever loop.
    pitch: THREE.MathUtils.clamp(Math.asin(steerDirection.y), -0.62, 0.62),
    turnRate: SWIM.playerTurnRate * (species?.turnScale ?? 1),
  };
}

/**
 * Turn the arrow keys into a heading.
 *
 * Relative where the cursor is absolute: a key says "keep turning this way",
 * not "go to that point". The eased axis scales the turn rate, so a turn leans
 * in when the key goes down and unwinds when it comes up, instead of switching
 * on and off.
 *
 * Speed is not touched. The keys change where the animal is pointing and
 * nothing else; it cruises at the same pace whether it is turning or not.
 *
 * The maths lives in `control/steering` so its signs can be tested against
 * which way the animal actually ends up going.
 */
function keyCommand(): SteerCommand {
  return keyboardCommand(
    input.steerX,
    input.steerY,
    swimmer.yaw,
    SWIM.playerTurnRate * (species?.turnScale ?? 1),
  );
}

// -- memory ------------------------------------------------------------------

/** Seconds between saves of the swim while the page is open. */
const SAVE_EVERY = 15;
let saveTimer = 0;
/** Set while leaving for a new ocean, so the swim being left is not saved back. */
let leaving = false;

function saveSwim(): void {
  if (leaving || !species) return;
  writeSwim({
    seed: worldSeed,
    species: species.id,
    x: swimmer.position.x,
    y: swimmer.position.y,
    z: swimmer.position.z,
    yaw: swimmer.yaw,
    pitch: swimmer.pitch,
    camera: rig.snapshot(),
  });
}

// A closed tab, a reload, and a tab put in the background all save, so the
// timer only has to cover a browser that is killed outright.
window.addEventListener("pagehide", saveSwim);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveSwim();
  sound.setHidden(document.hidden);
});

// -- sound -------------------------------------------------------------------

/**
 * Start the sound on the first touch of the page.
 *
 * Browsers refuse to play anything before the page has had a real input, so
 * this is the earliest moment there is. Capture phase, so it still runs when
 * something else stops the event going any further.
 */
function startSound(): void {
  sound.start();
  // The visibility listener only hears changes, so a page that is already
  // hidden when sound starts has to be told.
  sound.setHidden(document.hidden);
  soundControl.refresh();
  for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    window.removeEventListener(type, startSound, true);
  }
}
for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) {
  window.addEventListener(type, startSound, true);
}

let lastYaw = swimmer.yaw;

// -- frame -------------------------------------------------------------------

const loop = createLoop((dt, elapsed) => {
  input.tick(dt);
  current.update(elapsed);

  if (creature && species) {
    let command: SteerCommand;

    // The cursor wins when both are in use: it names a point to swim to, which
    // the keys cannot contradict without one of them being ignored anyway.
    if (input.steering || input.keySteering) {
      command = input.steering ? playerCommand() : keyCommand();
      // Keep feeding the trail while the player drives, so the autopilot does
      // not immediately double back over ground just covered when handed back.
      wander.recordPlayerPosition(dt, swimmer.position);
    } else {
      command = wander.update(dt, elapsed, swimmer);
      command.turnRate *= species.turnScale;
    }

    swimmer.update(dt, elapsed, command);

    // The same current that bends the kelp nudges the animal along, so even
    // holding a perfectly straight heading drifts slightly with the water.
    swimmer.position.addScaledVector(
      current.direction,
      current.strength * 0.32 * dt,
    );

    const rate = swimmer.speed / SWIM.cruiseSpeed;
    creature.update(elapsed, rate * species.speedScale);

    if (swapSettle < 1) {
      swapSettle = Math.min(1, swapSettle + dt / SWAP_SETTLE);
      const eased = swapSettle * swapSettle * (3 - 2 * swapSettle);
      creature.root.scale.setScalar(0.74 + eased * 0.26);
    }
  }

  chunks.update(swimmer.position);
  water.update(dt, swimmer.position);
  caustics.setTime(elapsed);
  decor.update(elapsed, current.direction, current.strength);
  fish.update(elapsed, swimmer.position);
  motes.update(dt, swimmer.position, current.direction, current.strength);
  shafts.update(dt, elapsed, swimmer.position);
  rig.update(dt, input, swimmer);

  titleCard.update(dt);

  const turnRate = dt > 0 ? Math.abs(angleDelta(lastYaw, swimmer.yaw)) / dt : 0;
  lastYaw = swimmer.yaw;
  sound.update(dt, {
    depth: swimmer.depth,
    speedRatio: swimmer.speed / SWIM.cruiseSpeed,
    turnRate,
  });

  saveTimer += dt;
  if (saveTimer >= SAVE_EVERY) {
    saveTimer = 0;
    saveSwim();
  }

  hud.update(dt, input.idleTime, {
    fps: loop.fps,
    chunks: chunks.liveCount,
    pending: chunks.pendingCount,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    programs: renderer.info.programs?.length ?? 0,
    depth: swimmer.depth,
    speed: swimmer.speed,
    clamped: swimmer.clamped,
    target: wander.currentTargetKey,
  });

  // Drag and wheel are accumulators; the camera has now had its look at them.
  input.consume();

  if (dioramaOn) {
    // Focus on the animal, so it stays crisp wherever the camera is orbiting
    // and the water in front and the reef behind are what go soft.
    diorama.render(scene, rig.camera, rig.camera.position.distanceTo(swimmer.position));
  } else {
    renderer.setRenderTarget(null);
    renderer.render(scene, rig.camera);
  }
});

/**
 * P toggles the diorama pass.
 *
 * Two reasons to keep it. It is the one part of the renderer with a cost that
 * scales with screen area rather than with what is in the scene, so it is the
 * first thing to turn off on a machine that is struggling. And the effect is
 * strong enough that the only honest way to judge it is to flick it off and
 * back on against the same view.
 */
let dioramaOn = true;
window.addEventListener("keydown", (event) => {
  if (event.key !== "p" && event.key !== "P") return;
  dioramaOn = !dioramaOn;
});

// -- lifecycle ---------------------------------------------------------------

window.addEventListener("resize", () => {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  diorama.setSize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
  rig.resize(window.innerWidth / window.innerHeight);
});

/**
 * Start a different ocean.
 *
 * The loading screen goes back up *before* navigating. The white flash on a
 * reload comes from the browser painting the new document before it has any
 * styles, and nothing the new page does can prevent what is shown while the old
 * one is still up. With both ends of the navigation showing the same gradient
 * there is no visible seam across it.
 */
function newOcean(): void {
  const boot = document.getElementById("boot");
  if (boot) {
    boot.dataset.done = "false";
  } else {
    // Already removed, so rebuild the same thing from the inline styles.
    const replacement = document.createElement("div");
    replacement.id = "boot";
    replacement.innerHTML = '<span class="boot__word">Currents</span>';
    document.body.appendChild(replacement);
  }

  // One frame for that to paint, then go. Reloading in the same tick would
  // navigate before the cover was ever shown.
  requestAnimationFrame(() => {
    // A different seed is a different ocean, and a reload is the cleanest way
    // to rebuild every system that derives from it. The species is dropped with
    // the rest of the hash so a new ocean also deals a new animal. The
    // remembered swim goes too, or the reload would resume the ocean being left.
    leaving = true;
    forgetSwim();
    location.hash = "";
    location.reload();
  });
}

window.addEventListener("keydown", (event) => {
  if (event.key !== "n" && event.key !== "N") return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  newOcean();
});

/**
 * Straight into the water. There is no menu.
 *
 * Choosing an animal used to be the first thing that happened, from a card with
 * a name and a sentence on it. Animals can now be swapped mid-swim, which does
 * that job better — you pick by watching one swim rather than by reading about
 * it — and what is left of the menu is a door in front of the thing people came
 * to see. `#species=` still names one directly for a link.
 */
const named =
  requestedSpecies() ??
  (resumed && SPECIES.some((entry) => entry.id === resumed.species) ? resumed.species : null);
adoptSpecies(named ? speciesById(named) : SPECIES[Math.floor(Math.random() * SPECIES.length)]!);

if (isAmbientMode()) {
  // Unattended display: start the overlay already faded rather than having it
  // sit there for the first few seconds of an empty room.
  hud.setAmbient();
} else if (!resumed) {
  // A resumed swim is the same swim carrying on, so it does not get the logo
  // again.
  titleCard.show();
}

// Dev-only inspection handle. Stripped from production builds, and the only
// way to poke at live state from the console without exporting internals.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__currents = {
    scene,
    swimmer,
    wander,
    chunks,
    rig,
    current,
    // The renderer and the diorama pass are here so a frame can be forced on
    // demand. The loop stops when the window is not being composited, which is
    // exactly when you most want to pose the camera and look at one frame.
    renderer,
    diorama,
    sound,
    saveSwim,
  };
}

// Render immediately, so the start screen sits over a living ocean rather than
// a black rectangle while the player reads it. Camera orientation for that
// first frame comes from the rig's own defaults.
if (CAMERA.idleEnabled) {
  rig.update(0.016, input, swimmer);
}

/**
 * Compile every shader the first frame will need, before that frame is drawn.
 *
 * Three compiles a material's program the first time it is actually rendered,
 * so without this the opening frame stalls while the terrain, the reef, the
 * water, the animal and the diorama pass are all built in turn. That stall
 * lands exactly where it is most visible: on the first thing anyone sees.
 * Doing it here moves the cost behind the loading screen, which is what a
 * loading screen is for.
 */
renderer.compile(scene, rig.camera);

loop.start();

/**
 * Take the loading screen down once there is genuinely something behind it.
 *
 * Two frames, not one. The first is the frame the compile above was preparing
 * for and can still be the slow one; waiting for a second means what gets
 * revealed is a world already running rather than one that judders as it is
 * uncovered.
 */
function dismissBoot(): void {
  const boot = document.getElementById("boot");
  if (!boot || boot.dataset.done === "true") return;
  boot.dataset.done = "true";
  // Removed rather than left transparent, so it can never intercept a pointer.
  window.setTimeout(() => boot.remove(), 1000);
}

requestAnimationFrame(() => requestAnimationFrame(dismissBoot));

// A stuck loading screen is far worse than an early one: if anything above
// throws, or the tab is backgrounded before a frame is ever drawn, the
// animation frames never arrive and the page would sit behind the gradient for
// good.
window.setTimeout(dismissBoot, 8000);
