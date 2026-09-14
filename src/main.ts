import * as THREE from "three";
import "./styles.css";

import { CAMERA, RENDER, SWIM } from "./core/config";
import { createLoop } from "./core/loop";
import { formatSeed, resolveWorldSeed } from "./core/rng";
import { CameraRig } from "./control/cameraRig";
import { createInput } from "./control/input";
import { Swimmer } from "./creatures/swimmer";
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
import { isAmbientMode, requestedSpecies, showStartScreen } from "./ui/startScreen";

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

const worldSeed = resolveWorldSeed();
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
const rig = new CameraRig(window.innerWidth / window.innerHeight);
const input = createInput(canvas);
const hud = new Hud();

scene.add(swimmer.object);

// Drop the swimmer a sensible distance above whatever the seabed happens to be
// doing at the origin of this particular world.
swimmer.position.y = terrain.heightAt(0, 0) + 18;
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

function adoptSpecies(chosen: SpeciesDef): void {
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
  rig.setPreferredDistance(chosen.viewDistance);
}

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
 * not "go to that point". The commanded yaw is therefore led far enough ahead
 * of the current one that it is always the turn-rate limit doing the work, and
 * the eased axis scales that limit — so a turn leans in when the key goes down
 * and unwinds when it comes up, instead of switching on and off.
 *
 * Speed is not touched. The keys change where the animal is pointing and
 * nothing else; it cruises at the same pace whether it is turning or not.
 */
function keyCommand(): SteerCommand {
  const strength = Math.max(Math.abs(input.steerX), Math.abs(input.steerY));

  return {
    yaw: swimmer.yaw + input.steerX * 1.2,
    // With no vertical key held this is level, so the animal eases back to flat
    // rather than holding whatever climb it was last given. A pitch that sticks
    // is the difference between steering and trimming, and only one of those is
    // relaxing to use.
    pitch: input.steerY * SWIM.keySteerMaxPitch,
    turnRate: SWIM.playerTurnRate * (species?.turnScale ?? 1) * strength,
  };
}

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
  }

  chunks.update(swimmer.position);
  water.update(dt, swimmer.position);
  caustics.setTime(elapsed);
  decor.update(elapsed, current.direction, current.strength);
  fish.update(elapsed, swimmer.position);
  motes.update(dt, swimmer.position, current.direction, current.strength);
  shafts.update(dt, elapsed, swimmer.position);
  rig.update(dt, input, swimmer);

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

const startRoot = document.getElementById("start")!;

const named = requestedSpecies();

if (named) {
  // A directly linked animal, e.g. #species=manta. Skips the menu.
  startRoot.remove();
  adoptSpecies(speciesById(named));
} else if (isAmbientMode()) {
  // Unattended display: no menu, no choice to make, just start swimming.
  startRoot.remove();
  adoptSpecies(SPECIES[Math.floor(Math.random() * SPECIES.length)]!);
  hud.setAmbient();
} else {
  void showStartScreen({
    root: startRoot,
    choicesHost: document.getElementById("start-choices")!,
    reseedButton: document.getElementById("start-reseed")!,
    onReseed: () => {
      // A different seed is a different ocean; a reload is the cleanest way to
      // rebuild every system that derives from it.
      location.hash = "";
      location.reload();
    },
  }).then(adoptSpecies);
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
  };
}

// Render immediately, so the start screen sits over a living ocean rather than
// a black rectangle while the player reads it. Camera orientation for that
// first frame comes from the rig's own defaults.
if (CAMERA.idleEnabled) {
  rig.update(0.016, input, swimmer);
}

loop.start();
