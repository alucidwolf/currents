import * as THREE from "three";
import { WORLD } from "../core/config";
import { chunkRng, mulberry32, pick, randRange } from "../core/rng";
import type { Rng } from "../core/rng";
import { buildBody } from "../creatures/shapes";
import type { PointOfInterest } from "../creatures/wander";
import { buildShipwreck, shipwreckForChunk } from "./landmarks";
import type { Terrain } from "./terrain";

/**
 * Everything growing on the seabed, and how it sways.
 *
 * All of a chunk's props — coral, boulders, kelp — are merged into a single
 * geometry, so the entire reef inside one chunk costs exactly one draw call.
 * That is cheaper and far simpler than instancing each prop type separately,
 * and it still allows per-vertex animation because every vertex carries a
 * baked `flex` weight: 0 for a boulder, rising toward 1 at the tip of a kelp
 * frond. One shared vertex shader then leans everything on the same current.
 */

const CORAL_COLORS = [0xc4705f, 0xd08a63, 0xa8566a, 0xc9a15c, 0x8f6b9e, 0xb5555a];
// Lifted well off black: against a dark teal fog the earlier greens read as
// silhouetted poles rather than as plants.
const KELP_COLORS = [0x6d8a45, 0x7d9a4c, 0x5c7a41, 0x8aa356, 0x647f3e];
const ROCK_COLORS = [0x5c6068, 0x4e535c, 0x6b6f76];

/**
 * Attempts per chunk, not placements. The reef-density field rejects most of
 * them on bare sand and lets nearly all of them through in a garden, which is
 * what produces dense reefs and open flats instead of an even sprinkle.
 */
const CORAL_ATTEMPTS = 30;
const ROCK_ATTEMPTS = 12;
const KELP_ATTEMPTS = 24;

/** Nothing grows on anything steeper than this. */
const MAX_SLOPE = 0.55;

interface Accumulator {
  positions: number[];
  colors: number[];
  flex: number[];
  indices: number[];
}

export interface ChunkDecor {
  geometry: THREE.BufferGeometry;
  pointsOfInterest: PointOfInterest[];
}

/** A validated placement site, carrying the surface normal already sampled. */
interface Spot {
  x: number;
  z: number;
  y: number;
  nx: number;
  ny: number;
  nz: number;
}

// -- prop builders -----------------------------------------------------------

/** A lumpy boulder. Rigid: flex stays at zero. */
function makeBoulder(rng: Rng): THREE.BufferGeometry {
  // Detail 1 gives 80 faces rather than 20 — still obviously a rock, but no
  // longer an obvious icosahedron. Polyhedron geometries are non-indexed, so
  // these keep hard facets even under the smooth-shaded decor material.
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;

  // Lumpiness must be a function of *direction*, not of vertex index. These
  // geometries are non-indexed, so every triangle carries its own copy of each
  // corner; displacing those copies independently tears the rock into loose
  // shards. Deriving the offset from the position means coincident corners
  // always move together and the surface stays welded.
  const phaseX = rng() * Math.PI * 2;
  const phaseY = rng() * Math.PI * 2;
  const phaseZ = rng() * Math.PI * 2;
  const squash = randRange(rng, 0.62, 0.85);

  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.set(position.getX(i), position.getY(i), position.getZ(i));
    const lump =
      0.84 +
      0.16 * Math.sin(v.x * 4.1 + phaseX) +
      0.13 * Math.sin(v.y * 5.3 + phaseY) +
      0.11 * Math.sin(v.z * 3.7 + phaseZ);
    v.multiplyScalar(lump);
    position.setXYZ(i, v.x, v.y * squash, v.z);
  }

  geometry.computeVertexNormals();
  return geometry;
}

/** A tapered tube standing on the seabed. The basic unit of most coral here. */
function makeStalk(
  rng: Rng,
  height: number,
  baseRadius: number,
  tipRadius: number,
): THREE.BufferGeometry {
  const stalk = buildBody({
    length: height,
    segments: 6,
    radial: 8,
    radius(t) {
      // t = 0 is the base of the tube, t = 1 the tip.
      const r = baseRadius + (tipRadius - baseRadius) * Math.pow(t, 0.8);
      return { x: r, y: r };
    },
  });

  // buildBody runs along Z and is centred; stand it up with its foot at zero.
  stalk.rotateX(-Math.PI / 2);
  stalk.translate(0, height / 2, 0);
  // A slight lean so a cluster never looks like a set of identical posts.
  stalk.rotateZ(randRange(rng, -0.12, 0.12));
  return stalk;
}

/**
 * Branching coral: tapered tubes fanning upward and outward.
 *
 * These were stretched octahedra, which is where most of the "blocky" read
 * came from — eight faces cannot describe a branch. Proper tubes cost a few
 * dozen more vertices each and are the single biggest fidelity win down here.
 */
function makeBranchingCoral(rng: Rng): THREE.BufferGeometry {
  const branches: THREE.BufferGeometry[] = [];
  const count = 4 + Math.floor(rng() * 5);

  for (let i = 0; i < count; i++) {
    const height = randRange(rng, 0.9, 2.4);
    const branch = makeStalk(rng, height, randRange(rng, 0.1, 0.2), 0.035);

    const lean = randRange(rng, 0.08, 0.55);
    const around = rng() * Math.PI * 2;
    branch.rotateX(Math.cos(around) * lean);
    branch.rotateZ(Math.sin(around) * lean);
    branch.translate(
      Math.sin(around) * randRange(rng, 0, 0.45),
      0,
      Math.cos(around) * randRange(rng, 0, 0.45),
    );

    branches.push(branch);
  }

  return mergeSimple(branches);
}

/** Brain coral: a low rounded dome, the calm counterpoint to the branches. */
function makeBrainCoral(rng: Rng): THREE.BufferGeometry {
  const dome = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
  dome.scale(1, randRange(rng, 0.5, 0.85), randRange(rng, 0.82, 1.18));

  // Same rule as the boulders: the wobble is derived from position so the
  // duplicated vertices along the sphere's UV seam move identically and no
  // crack opens up down one side.
  const phase = rng() * Math.PI * 2;
  const position = dome.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    v.set(position.getX(i), position.getY(i), position.getZ(i));
    const wobble =
      0.94 + 0.07 * Math.sin(v.x * 5.2 + phase) + 0.06 * Math.sin(v.z * 4.4 - phase);
    v.multiplyScalar(wobble);
    position.setXYZ(i, v.x, v.y, v.z);
  }

  dome.computeVertexNormals();
  return dome;
}

/** Fan coral: a broad thin blade standing across the current. */
function makeFanCoral(rng: Rng): THREE.BufferGeometry {
  const width = randRange(rng, 1.2, 2.4);
  const height = randRange(rng, 1.0, 2.2);

  const fan = new THREE.PlaneGeometry(width, height, 7, 6);
  fan.translate(0, height / 2, 0);

  // Round off the silhouette and ripple the surface, so it reads as a living
  // fan rather than a rectangle of card.
  const position = fan.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const t = y / height;
    const taper = Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.06));
    position.setX(i, x * (0.35 + taper * 0.75));
    position.setZ(i, Math.sin(x * 3.1 + t * 2.0) * 0.12);
  }
  fan.computeVertexNormals();
  fan.rotateY(rng() * Math.PI);

  // Thin blades vanish edge-on, so pair it with a narrower cross blade.
  const cross = fan.clone();
  cross.scale(0.55, 0.85, 1);
  cross.rotateY(Math.PI / 2);

  return mergeSimple([fan, cross]);
}

/** Tube coral: a tight clump of thin vertical pipes. */
function makeTubeCoral(rng: Rng): THREE.BufferGeometry {
  const tubes: THREE.BufferGeometry[] = [];
  const count = 5 + Math.floor(rng() * 6);

  for (let i = 0; i < count; i++) {
    const height = randRange(rng, 0.5, 1.7);
    const tube = makeStalk(rng, height, randRange(rng, 0.07, 0.13), 0.09);
    const around = rng() * Math.PI * 2;
    const spread = randRange(rng, 0, 0.38);
    tube.translate(Math.sin(around) * spread, 0, Math.cos(around) * spread);
    tubes.push(tube);
  }

  return mergeSimple(tubes);
}

function makeCoral(rng: Rng): THREE.BufferGeometry {
  const roll = rng();
  if (roll < 0.42) return makeBranchingCoral(rng);
  if (roll < 0.66) return makeTubeCoral(rng);
  if (roll < 0.86) return makeBrainCoral(rng);
  return makeFanCoral(rng);
}

// -- prototype library -------------------------------------------------------

/**
 * Props are built once and reused, not regenerated per chunk.
 *
 * Constructing them per placement made chunk decor cost 22ms — nineteen times
 * the terrain mesh it sits on, and the sole cause of every dropped frame while
 * streaming. Nearly all of that was geometry construction: allocating typed
 * arrays, merging branches, and computing normals that the chunk's own merge
 * then throws away and recomputes anyway.
 *
 * A fixed library sampled at random, combined with per-placement scale,
 * rotation and tint, is visually indistinguishable from unique geometry at the
 * distances these are seen — and costs nothing after the first chunk.
 */
interface PropLibrary {
  coral: THREE.BufferGeometry[];
  rock: THREE.BufferGeometry[];
  kelp: THREE.BufferGeometry[];
}

let library: PropLibrary | null = null;

function props(): PropLibrary {
  if (library) return library;

  // Fixed seed: the library is world-independent, so every ocean draws from
  // the same shapes and only placement differs.
  const rng = mulberry32(0x0c02a1);
  library = {
    coral: Array.from({ length: 18 }, () => makeCoral(rng)),
    rock: Array.from({ length: 10 }, () => makeBoulder(rng)),
    kelp: Array.from({ length: 12 }, () => makeKelp(rng)),
  };
  return library;
}

/**
 * A kelp frond: two tall strips crossed at right angles.
 *
 * A single plane disappears to a hairline when viewed edge-on, so a kelp bed
 * would visibly thin out and reappear as the camera orbited. Crossing two
 * planes costs a handful of extra triangles and gives the frond presence from
 * every angle. The vertical subdivision is what lets the sway shader bend it
 * into a curve rather than tilting it rigidly.
 */
function makeKelp(rng: Rng): THREE.BufferGeometry {
  const height = randRange(rng, 3.5, 8.5);
  const width = randRange(rng, 0.28, 0.62);
  const twist = rng() * Math.PI;

  const blade = (w: number, h: number, turn: number) => {
    const geometry = new THREE.PlaneGeometry(w, h, 1, 6);
    geometry.translate(0, h / 2, 0);

    // Taper toward the tip. A constant-width strip reads as a plank; narrowing
    // it is the single change that makes it look grown rather than cut.
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const t = Math.max(0, position.getY(i)) / h;
      position.setX(i, position.getX(i) * (1 - 0.62 * t * t));
    }

    geometry.rotateY(turn);
    return geometry;
  };

  return mergeSimple([
    blade(width, height, twist),
    blade(width * 0.85, height * 0.94, twist + Math.PI / 2),
  ]);
}

function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  let offset = 0;

  for (const part of parts) {
    const pos = part.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    const index = part.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + offset);
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(i + offset);
    }
    offset += pos.count;
    part.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setIndex(indices);
  merged.computeVertexNormals();
  return merged;
}

// -- placement ---------------------------------------------------------------

/**
 * Append one prop into the chunk accumulator, transformed into chunk-local
 * space and carrying its colour and flex weights.
 */
function appendProp(
  acc: Accumulator,
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  color: THREE.Color,
  flexAt: (localY: number, maxY: number) => number,
): void {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();
  const base = acc.positions.length / 3;

  let maxY = 1e-5;
  for (let i = 0; i < position.count; i++) {
    maxY = Math.max(maxY, position.getY(i));
  }

  for (let i = 0; i < position.count; i++) {
    const localY = position.getY(i);
    vertex.set(position.getX(i), localY, position.getZ(i)).applyMatrix4(matrix);

    acc.positions.push(vertex.x, vertex.y, vertex.z);
    acc.colors.push(color.r, color.g, color.b);
    acc.flex.push(flexAt(localY, maxY));
  }

  const index = geometry.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i++) acc.indices.push(index.getX(i) + base);
  } else {
    for (let i = 0; i < position.count; i++) acc.indices.push(i + base);
  }

  // Deliberately does not dispose: most sources are shared library prototypes
  // that must survive for the life of the process. One-off geometry (wreck
  // parts) is disposed by its caller.
}

/**
 * Build everything growing in one chunk.
 *
 * Placement is driven entirely by a generator seeded from the world seed and
 * the chunk's own coordinates, so a chunk regenerates identically every time it
 * streams back in — swim away from a reef and back, and it is the same reef.
 */
export function buildChunkDecor(
  worldSeed: number,
  cx: number,
  cz: number,
  terrain: Terrain,
): ChunkDecor | null {
  const rng = chunkRng(worldSeed, cx, cz, 0x5eed);
  const shapes = props();
  const originX = cx * WORLD.chunkSize;
  const originZ = cz * WORLD.chunkSize;

  const acc: Accumulator = { positions: [], colors: [], flex: [], indices: [] };
  const pointsOfInterest: PointOfInterest[] = [];

  const color = new THREE.Color();
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const translation = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const surfaceNormal = new THREE.Vector3();
  const normal = { x: 0, y: 1, z: 0 };

  /**
   * Find a spot that is not on a cliff. Gives up rather than forcing it.
   *
   * The surface normal is carried out with the spot rather than recomputed
   * when the prop is placed. Each normal costs four terrain samples, and this
   * runs tens of times per chunk — chunk construction is the one genuinely hot
   * path in the project, so the duplication was worth removing.
   */
  const findSpot = (): Spot | null => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const x = originX + rng() * WORLD.chunkSize;
      const z = originZ + rng() * WORLD.chunkSize;
      terrain.normalAt(x, z, 1.5, normal);
      if (1 - normal.y > MAX_SLOPE) continue;
      return {
        x,
        z,
        y: terrain.heightAt(x, z),
        nx: normal.x,
        ny: normal.y,
        nz: normal.z,
      };
    }
    return null;
  };

  const place = (
    geometry: THREE.BufferGeometry,
    spot: Spot,
    size: number,
    tint: number,
    flexAt: (localY: number, maxY: number) => number,
    alignToSlope: boolean,
  ) => {
    if (alignToSlope) {
      surfaceNormal.set(spot.nx, spot.ny, spot.nz);
      quaternion.setFromUnitVectors(up, surfaceNormal);
    } else {
      quaternion.identity();
    }

    // Spin each placement about its own axis. With a shared prototype library
    // this is what stops repeats being recognisable — the same coral seen from
    // two different angles does not read as the same coral.
    spin.setFromAxisAngle(up, rng() * Math.PI * 2);
    quaternion.multiply(spin);

    // Chunk-local, because the mesh itself is positioned at the chunk origin.
    translation.set(spot.x - originX, spot.y, spot.z - originZ);
    scale.setScalar(size);
    matrix.compose(translation, quaternion, scale);

    color.setHex(tint);
    // A little per-prop brightness variation stops a field of coral reading as
    // one flat mass of identical colour.
    color.multiplyScalar(randRange(rng, 0.78, 1.18));
    appendProp(acc, geometry, matrix, color, flexAt);
  };

  const rigid = () => 0;
  const coralFlex = (y: number, maxY: number) => (y / maxY) * 0.22;
  const kelpFlex = (y: number, maxY: number) => Math.pow(Math.max(y, 0) / maxY, 1.4);

  // Boulders scatter everywhere — they are geology, not biology — but thin out
  // a little in the lushest gardens where coral has taken the ground.
  for (let i = 0; i < ROCK_ATTEMPTS; i++) {
    const spot = findSpot();
    if (!spot) continue;
    if (rng() < terrain.reefDensityAt(spot.x, spot.z) * 0.45) continue;
    place(
      pick(rng, shapes.rock),
      { ...spot, y: spot.y - 0.25 },
      randRange(rng, 0.7, 2.8),
      ROCK_COLORS[Math.floor(rng() * ROCK_COLORS.length)]!,
      rigid,
      true,
    );
  }

  let coralPlaced = 0;
  for (let i = 0; i < CORAL_ATTEMPTS; i++) {
    const spot = findSpot();
    if (!spot) continue;

    const density = terrain.reefDensityAt(spot.x, spot.z);
    if (rng() > density) continue;

    place(
      pick(rng, shapes.coral),
      spot,
      // Coral grows larger where the reef is richest, so a garden reads as
      // established rather than just crowded.
      randRange(rng, 0.75, 1.6) * (0.8 + density * 0.95),
      CORAL_COLORS[Math.floor(rng() * CORAL_COLORS.length)]!,
      coralFlex,
      true,
    );
    coralPlaced++;

    // The first couple of coral heads in a chunk double as somewhere for the
    // autopilot to drift toward, so wandering passes scenery rather than sand.
    if (coralPlaced <= 2) {
      pointsOfInterest.push({
        key: `coral:${cx}:${cz}:${i}`,
        position: new THREE.Vector3(spot.x, spot.y + 6, spot.z),
        weight: 1,
      });
    }
  }

  for (let i = 0; i < KELP_ATTEMPTS; i++) {
    const spot = findSpot();
    if (!spot) continue;
    if (rng() > terrain.reefDensityAt(spot.x, spot.z) * 0.9) continue;
    place(
      pick(rng, shapes.kelp),
      spot,
      randRange(rng, 0.8, 1.6),
      KELP_COLORS[Math.floor(rng() * KELP_COLORS.length)]!,
      kelpFlex,
      false,
    );
  }

  // --- Landmark: a wreck, if this chunk happens to hold one ------------------
  const wreck = shipwreckForChunk(worldSeed, cx, cz);
  if (wreck) {
    const worldX = originX + wreck.localX;
    const worldZ = originZ + wreck.localZ;
    const settledY = terrain.heightAt(worldX, worldZ) - wreck.bury;

    const orientation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(wreck.pitch, wreck.yaw, wreck.roll, "YXZ"),
    );
    const wreckMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(wreck.localX, settledY, wreck.localZ),
      orientation,
      new THREE.Vector3(wreck.scale, wreck.scale, wreck.scale),
    );

    // Wrecks are one-offs rather than library prototypes — too rare to be worth
    // caching, and each should be genuinely unique — so their geometry is
    // released once its vertices have been folded into the chunk.
    for (const part of buildShipwreck(rng)) {
      color.setHex(part.color);
      color.multiplyScalar(randRange(rng, 0.85, 1.1));
      appendProp(acc, part.geometry, wreckMatrix, color, rigid);
      part.geometry.dispose();
    }

    // Worth a detour: wrecks outrank coral and fish as somewhere to drift past.
    pointsOfInterest.push({
      key: `wreck:${cx}:${cz}`,
      position: new THREE.Vector3(worldX, settledY + 12, worldZ),
      weight: 5,
    });
  }

  if (acc.positions.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(acc.positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(acc.colors, 3));
  geometry.setAttribute("flex", new THREE.Float32BufferAttribute(acc.flex, 1));
  geometry.setIndex(acc.indices);
  geometry.computeVertexNormals();

  return { geometry, pointsOfInterest };
}

// -- material ----------------------------------------------------------------

export interface DecorMaterial {
  material: THREE.Material;
  update(elapsed: number, direction: THREE.Vector3, strength: number): void;
}

/**
 * One material for every prop in the world.
 *
 * The sway is driven by the shared current direction plus a phase derived from
 * world position, so neighbouring fronds lean together but not in lockstep —
 * the thing that would immediately look mechanical.
 */
export function makeDecorMaterial(): DecorMaterial {
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    // Smooth now that coral is built from tubes and domes rather than
    // octahedra. Boulders keep their facets regardless, because polyhedron
    // geometries are non-indexed and so never share a normal between faces.
    flatShading: false,
    side: THREE.DoubleSide,
  });

  const uniforms = {
    uDecorTime: { value: 0 },
    uCurrentDir: { value: new THREE.Vector2(1, 0) },
    uCurrentStrength: { value: 0.7 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         attribute float flex;
         uniform float uDecorTime;
         uniform vec2 uCurrentDir;
         uniform float uCurrentStrength;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         {
           vec3 worldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
           // Phase from world position: fronds a few metres apart lean at
           // slightly different moments, which is what stops a kelp bed
           // looking like it is bending on a hinge.
           float phase = worldPos.x * 0.12 + worldPos.z * 0.09;
           float wave = sin( uDecorTime * 0.9 + phase )
                      + sin( uDecorTime * 0.53 + phase * 1.7 ) * 0.5;
           float amount = flex * uCurrentStrength * wave * 1.15;
           transformed.x += uCurrentDir.x * amount;
           transformed.z += uCurrentDir.y * amount;
           // Leaning costs a little height, as a real frond bending would.
           transformed.y -= abs( amount ) * flex * 0.16;
         }`,
      );
  };

  material.customProgramCacheKey = () => "currents-decor";

  return {
    material,
    update(elapsed, direction, strength) {
      uniforms.uDecorTime.value = elapsed;
      uniforms.uCurrentDir.value.set(direction.x, direction.z);
      uniforms.uCurrentStrength.value = strength;
    },
  };
}
