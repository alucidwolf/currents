import * as THREE from "three";
import { WORLD } from "../core/config";
import { chunkRng, mulberry32, randRange } from "../core/rng";
import type { Rng } from "../core/rng";
import { buildBody } from "../creatures/shapes";
import type { PointOfInterest } from "../creatures/wander";
import { ColonyKind, PropKind, collectColonies } from "./colonies";
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

// Saturated and bright, to sit as clean blocks of colour against the water
// rather than as muted lumps. A reef is the one place in the scene where
// strong hue is doing the work.
const CORAL_COLORS = [0xe8836b, 0xf0a06e, 0xdc6a85, 0xeebb6d, 0xa87fc6, 0xe06a72];
// Lifted well off black: against the fog the earlier greens read as
// silhouetted poles rather than as plants.
const KELP_COLORS = [0x82a955, 0x93b962, 0x6f9749, 0xa3c46c, 0x7a9d4d];
// Kept dark, but not all one grey. A boulder is the highest-contrast thing on
// a pale seabed, so a field of identical slate-blue ones is the first thing the
// eye lands on — and reading the floor as "rocks scattered about" is exactly
// the failure that clustering is meant to fix. The warmer, sandier tones sit
// back into the ground instead of jumping out of it.
const ROCK_COLORS = [0x646f7b, 0x55606b, 0x73808d, 0x7c7566, 0x8a8271, 0x6b6a63];
// Softer than the small coral — several metres of one hue turns garish at the
// reef palette's saturation — but no darker. A structure is usually the largest
// mass in the view and half of it faces away from the sun, so a base colour
// chosen to look right on a swatch reads as a black lump on the seabed.
const STRUCTURE_COLORS = [0xd98a6e, 0xcf6b82, 0xe0a05e, 0xab88ca, 0xcf7d5f, 0xc08da4];

/**
 * Strays: props placed at random across the whole chunk rather than as part of
 * a colony.
 *
 * Kept deliberately thin. Their job is to stop the gap between two colonies
 * being conspicuously sterile — a lone coral head on open sand reads as natural,
 * while a uniform sprinkle of them is exactly the litter the colonies replaced.
 */
const STRAY_ATTEMPTS = 7;

/** Nothing grows on anything steeper than this. */
const MAX_SLOPE = 0.55;
/** Rock is geology, not biology, and will happily sit on a much steeper face. */
const MAX_ROCK_SLOPE = 0.78;

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

/**
 * Push a geometry's vertices in and out by a smooth function of *position*.
 *
 * The displacement must derive from where a vertex is, never from its index.
 * Several of the geometries used here duplicate vertices — polyhedra are
 * non-indexed, so every triangle carries its own copy of each corner, and a
 * sphere duplicates the ring along its UV seam. Displacing those copies
 * independently tears the surface into loose shards or opens a crack down one
 * side. Deriving the offset from the position means coincident vertices always
 * move together and the surface stays welded.
 */
function roughen(
  geometry: THREE.BufferGeometry,
  rng: Rng,
  amount: number,
  frequency = 4.4,
): void {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const phaseX = rng() * Math.PI * 2;
  const phaseY = rng() * Math.PI * 2;
  const phaseZ = rng() * Math.PI * 2;

  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.set(position.getX(i), position.getY(i), position.getZ(i));
    const lump =
      1 +
      amount *
        (Math.sin(v.x * frequency + phaseX) +
          0.82 * Math.sin(v.y * frequency * 1.29 + phaseY) +
          0.7 * Math.sin(v.z * frequency * 0.85 + phaseZ));
    position.setXYZ(i, v.x * lump, v.y * lump, v.z * lump);
  }
}

/** A lumpy boulder. Rigid: flex stays at zero. */
function makeBoulder(rng: Rng): THREE.BufferGeometry {
  // Detail 1 gives 80 faces rather than 20 — still obviously a rock, but no
  // longer an obvious icosahedron. Polyhedron geometries are non-indexed, so
  // these keep hard facets even under the smooth-shaded decor material.
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  roughen(geometry, rng, 0.15, 4.1);
  geometry.scale(1, randRange(rng, 0.62, 0.85), 1);
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
    // Low on purpose. A coral clump is a dozen of these, and clumps are now the
    // densest thing in the world — the survey's peak chunk is where the whole
    // streaming budget gets spent, so the unit cost of a branch matters far
    // more than its silhouette at the distance one is ever seen from.
    segments: 5,
    radial: 6,
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
  const count = 3 + Math.floor(rng() * 4);

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
  const dome = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62);
  roughen(dome, rng, 0.035, 5.2);
  dome.scale(1, randRange(rng, 0.5, 0.85), randRange(rng, 0.82, 1.18));
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
  const count = 4 + Math.floor(rng() * 4);

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

// -- large structures --------------------------------------------------------

/**
 * The anchor of a reef colony: several metres tall, and the reason a garden
 * reads as a place rather than a patch of ground with things on it.
 *
 * Everything else down here tops out around waist height on a swimming whale,
 * which is why the floor felt flat no matter how much was scattered on it — a
 * scene needs something to swim *over* and *around*, not just past. These are
 * built at roughly three to five units tall in their own space and placed at
 * around 1.5x, so a good one stands eight metres off the seabed.
 */

/** A coral head: lumpy lobes stacked into a boulder-sized mass of living rock. */
function makeBommie(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const lobes = 3 + Math.floor(rng() * 3);

  let radius = randRange(rng, 1.3, 1.8);
  let height = 0;

  for (let i = 0; i < lobes; i++) {
    const lobe = new THREE.SphereGeometry(radius, 12, 8);
    roughen(lobe, rng, 0.085, 3.2 / radius);
    lobe.scale(1, randRange(rng, 0.78, 1.15), randRange(rng, 0.85, 1.15));

    // Each lobe sits on the one below, nudged sideways so the stack leans and
    // bulges instead of rising as a column of beads.
    const drift = radius * randRange(rng, 0, 0.42);
    const around = rng() * Math.PI * 2;
    lobe.translate(Math.cos(around) * drift, height + radius * 0.72, Math.sin(around) * drift);

    parts.push(lobe);
    // Lobes overlap heavily. Spaced any further apart they read as a stack of
    // separate balls rather than as one irregular mass of coral.
    height += radius * randRange(rng, 0.45, 0.72);
    radius *= randRange(rng, 0.68, 0.86);
  }

  // A few short branches off the top, so the silhouette is not purely rounded.
  const knobs = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < knobs; i++) {
    const knob = makeStalk(rng, randRange(rng, 0.5, 1.2), randRange(rng, 0.12, 0.22), 0.06);
    const around = rng() * Math.PI * 2;
    const lean = randRange(rng, 0.15, 0.7);
    knob.rotateX(Math.cos(around) * lean);
    knob.rotateZ(Math.sin(around) * lean);
    knob.translate(
      Math.cos(around) * randRange(rng, 0, radius * 1.6),
      height * randRange(rng, 0.72, 1),
      Math.sin(around) * randRange(rng, 0, radius * 1.6),
    );
    parts.push(knob);
  }

  return mergeSimple(parts);
}

/**
 * Table coral: a broad horizontal plate on a short stem.
 *
 * The most recognisable large coral silhouette there is, and the only one here
 * that reads as wide rather than tall — worth having because a reef of nothing
 * but vertical forms starts to look like a pipe organ.
 */
function makeTableCoral(rng: Rng): THREE.BufferGeometry {
  const stemHeight = randRange(rng, 1.1, 2.0);
  const spread = randRange(rng, 1.7, 2.9);

  const stem = makeStalk(rng, stemHeight * 1.06, randRange(rng, 0.3, 0.44), 0.3);

  const plate = new THREE.CylinderGeometry(spread, spread * 0.94, 0.22, 16, 3);
  const position = plate.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const r = Math.hypot(x, z) / spread;
    const angle = Math.atan2(z, x);
    // The rim droops and ripples; a flat disc reads as a manufactured part.
    position.setY(
      i,
      position.getY(i) - r * r * randRange(rng, 0.3, 0.6) + Math.sin(angle * 3.4) * r * 0.16,
    );
  }
  plate.translate(0, stemHeight, 0);

  return mergeSimple([stem, plate]);
}

/**
 * Barrel sponge: a hollow flared column.
 *
 * A lathe rather than a cylinder, because the profile runs up the outside, over
 * the rim and back down the inside — so it is genuinely open at the top and you
 * can see into it when swimming over, which a capped tube never sells.
 */
function makeBarrelSponge(rng: Rng): THREE.BufferGeometry {
  const height = randRange(rng, 2.2, 4.0);
  const baseRadius = randRange(rng, 0.55, 0.85);
  const flare = randRange(rng, 0.35, 0.75);

  const outer = (t: number) => baseRadius + Math.sin(t * Math.PI * 0.62) * flare + t * 0.22;

  const profile: THREE.Vector2[] = [];
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    profile.push(new THREE.Vector2(outer(t), t * height));
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    // Wall thickness tapers with the flare, so the rim stays thin.
    profile.push(new THREE.Vector2(outer(t) * 0.7, t * height * 0.97));
  }
  profile.push(new THREE.Vector2(0.02, height * 0.12));

  const barrel = new THREE.LatheGeometry(profile, 14);
  roughen(barrel, rng, 0.03, 2.4);
  barrel.computeVertexNormals();
  return barrel;
}

/** Pillar coral: thick fingers rising from a common base. */
function makePillarCoral(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const base = new THREE.SphereGeometry(randRange(rng, 1.0, 1.5), 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
  base.scale(1, randRange(rng, 0.45, 0.7), 1);
  parts.push(base);

  const columns = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < columns; i++) {
    const height = randRange(rng, 2.2, 4.2);
    const column = makeStalk(rng, height, randRange(rng, 0.26, 0.42), randRange(rng, 0.14, 0.24));

    // A gentle lengthwise curve. Perfectly straight columns look extruded.
    const curve = randRange(rng, -0.35, 0.35);
    const position = column.getAttribute("position") as THREE.BufferAttribute;
    for (let v = 0; v < position.count; v++) {
      const t = Math.max(0, position.getY(v)) / height;
      position.setX(v, position.getX(v) + t * t * curve);
    }

    const around = (i / columns) * Math.PI * 2 + randRange(rng, -0.5, 0.5);
    const spread = randRange(rng, 0.15, 0.85);
    column.translate(Math.cos(around) * spread, randRange(rng, 0.1, 0.4), Math.sin(around) * spread);
    parts.push(column);
  }

  return mergeSimple(parts);
}

function makeStructure(rng: Rng): THREE.BufferGeometry {
  const roll = rng();
  if (roll < 0.38) return makeBommie(rng);
  if (roll < 0.64) return makePillarCoral(rng);
  if (roll < 0.85) return makeTableCoral(rng);
  return makeBarrelSponge(rng);
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
  /** Large anchors. Fewer variants, because far fewer are ever placed. */
  structure: THREE.BufferGeometry[];
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
    structure: Array.from({ length: 14 }, () => makeStructure(rng)),
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
  const height = randRange(rng, 3.2, 7.8);
  // Broad fronds, not straps. Narrow blades read as bare poles at any
  // distance; the reference look wants plants with visible surface area.
  const width = randRange(rng, 0.7, 1.5);
  const twist = rng() * Math.PI;

  const blade = (w: number, h: number, turn: number) => {
    const geometry = new THREE.PlaneGeometry(w, h, 1, 6);
    geometry.translate(0, h / 2, 0);

    // Narrow at the holdfast, broad through the middle, tapering to the tip —
    // the shape a frond actually grows into, and far more plant-like than a
    // strip that simply narrows from the base.
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const t = Math.max(0, position.getY(i)) / h;
      const widthAt = Math.sin(Math.PI * Math.pow(t, 0.72)) * 0.85 + 0.2;
      position.setX(i, position.getX(i) * widthAt);
      // A gentle lengthwise curl, so a bed of them is not a row of flat cards.
      position.setZ(i, position.getZ(i) + Math.sin(t * 2.4) * w * 0.35);
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
   * Sample the ground, rejecting anything too steep to sit on.
   *
   * The surface normal is carried out with the spot rather than recomputed when
   * the prop is placed. Each normal costs four terrain samples, and this runs
   * tens of times per chunk — chunk construction is the one genuinely hot path
   * in the project, so the duplication was worth removing.
   */
  const siteAt = (x: number, z: number, maxSlope: number): Spot | null => {
    terrain.normalAt(x, z, 1.5, normal);
    if (1 - normal.y > maxSlope) return null;
    return {
      x,
      z,
      y: terrain.heightAt(x, z),
      nx: normal.x,
      ny: normal.y,
      nz: normal.z,
    };
  };

  const place = (
    geometry: THREE.BufferGeometry,
    spot: Spot,
    size: number,
    tint: number,
    flexAt: (localY: number, maxY: number) => number,
    /** How far the prop tips with the ground: 0 stands upright, 1 sits flush. */
    align: number,
    turn: number,
    /** Multiplier on the base colour. Varies per prop, never per vertex. */
    brightness: number,
  ) => {
    if (align > 0) {
      surfaceNormal.set(spot.nx, spot.ny, spot.nz).lerp(up, 1 - align).normalize();
      quaternion.setFromUnitVectors(up, surfaceNormal);
    } else {
      quaternion.identity();
    }

    // Spin each placement about its own axis. With a shared prototype library
    // this is what stops repeats being recognisable — the same coral seen from
    // two different angles does not read as the same coral.
    spin.setFromAxisAngle(up, turn * Math.PI * 2);
    quaternion.multiply(spin);

    // Chunk-local, because the mesh itself is positioned at the chunk origin.
    translation.set(spot.x - originX, spot.y, spot.z - originZ);
    scale.setScalar(size);
    matrix.compose(translation, quaternion, scale);

    color.setHex(tint);
    color.multiplyScalar(brightness);
    appendProp(acc, geometry, matrix, color, flexAt);
  };

  const rigid = () => 0;
  const coralFlex = (y: number, maxY: number) => (y / maxY) * 0.22;
  // A structure is a solid mass of coral or sponge several metres across. It
  // does not sway, and letting it would immediately give away that everything
  // down here is bending on the same shader.
  const structureFlex = rigid;
  const kelpFlex = (y: number, maxY: number) => Math.pow(Math.max(y, 0) / maxY, 1.4);

  const from = <T>(list: readonly T[], at: number): T =>
    list[Math.min(list.length - 1, Math.floor(at * list.length))]!;

  /** Turn one colony member — or a stray — into geometry on the seabed. */
  const placeProp = (
    prop: PropKind,
    x: number,
    z: number,
    size: number,
    variant: number,
    tint: number,
    turn: number,
    shade: number,
  ): Spot | null => {
    const spot = siteAt(x, z, prop === PropKind.Rock ? MAX_ROCK_SLOPE : MAX_SLOPE);
    if (!spot) return null;

    // A little per-prop brightness variation stops a field of coral reading as
    // one flat mass of identical colour. Structures get a much tighter range:
    // the same swing that reads as pleasant variety across two dozen small
    // corals turns a single five-metre mass either chalky or nearly black.
    const brightness =
      prop === PropKind.Structure ? 0.9 + shade * 0.22 : 0.78 + shade * 0.4;

    switch (prop) {
      case PropKind.Rock:
        place(
          from(shapes.rock, variant),
          // Settled slightly into the sand rather than resting on top of it.
          { ...spot, y: spot.y - 0.25 },
          size,
          from(ROCK_COLORS, tint),
          rigid,
          1,
          turn,
          brightness,
        );
        break;
      case PropKind.Kelp:
        place(
          from(shapes.kelp, variant),
          spot,
          size,
          from(KELP_COLORS, tint),
          kelpFlex,
          // Kelp grows toward the light, not out of the slope it is rooted in.
          0,
          turn,
          brightness,
        );
        break;
      case PropKind.Structure:
        place(
          from(shapes.structure, variant),
          { ...spot, y: spot.y - 0.4 },
          size,
          from(STRUCTURE_COLORS, tint),
          structureFlex,
          // Only partly. A small prop lying flush with a slope looks settled;
          // a five-metre coral head at the same angle looks like it fell over.
          0.4,
          turn,
          brightness,
        );
        break;
      default:
        place(
          from(shapes.coral, variant),
          spot,
          size,
          from(CORAL_COLORS, tint),
          coralFlex,
          0.85,
          turn,
          brightness,
        );
        break;
    }

    return spot;
  };

  // --- Colonies: the bulk of the seabed's life ------------------------------
  const { members, sites } = collectColonies(worldSeed, cx, cz, terrain);

  for (const member of members) {
    placeProp(
      member.prop,
      member.x,
      member.z,
      member.size,
      member.variant,
      member.tint,
      member.spin,
      member.shade,
    );
  }

  // Somewhere for the autopilot to drift toward. A colony centre is a far
  // better target than an arbitrary coral head was: it aims the animal at the
  // middle of a cluster rather than at whichever prop happened to be placed
  // first, and there is exactly one per colony rather than two per chunk.
  for (const site of sites) {
    const weight =
      site.landmark ? 3 : site.kind === ColonyKind.Reef ? 1.6 : site.kind === ColonyKind.KelpBed ? 1 : 0.5;
    pointsOfInterest.push({
      key: site.key,
      position: new THREE.Vector3(
        site.x,
        terrain.heightAt(site.x, site.z) + (site.landmark ? 11 : 7),
        site.z,
      ),
      weight,
    });
  }

  // --- Strays: a thin scatter over the open ground between colonies ---------
  for (let i = 0; i < STRAY_ATTEMPTS; i++) {
    const x = originX + rng() * WORLD.chunkSize;
    const z = originZ + rng() * WORLD.chunkSize;
    const density = terrain.reefDensityAt(x, z);

    // Rock on the bare flats, the occasional lone coral or frond where the
    // ground is fertile enough to support one.
    const roll = rng();
    const prop =
      roll < 0.3 + (1 - density) * 0.3
        ? PropKind.Rock
        : roll < 0.78
          ? PropKind.Coral
          : PropKind.Kelp;

    if (prop !== PropKind.Rock && rng() > density * 0.75) continue;

    placeProp(
      prop,
      x,
      z,
      prop === PropKind.Rock ? randRange(rng, 0.6, 2.2) : randRange(rng, 0.7, 1.2),
      rng(),
      rng(),
      rng(),
      rng(),
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
