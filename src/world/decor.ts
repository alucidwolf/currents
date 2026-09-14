import * as THREE from "three";
import { WORLD } from "../core/config";
import { chunkRng, randRange } from "../core/rng";
import type { Rng } from "../core/rng";
import type { PointOfInterest } from "../creatures/wander";
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
const KELP_COLORS = [0x4e6b39, 0x5c7a3c, 0x3f5c33, 0x68864a];
const ROCK_COLORS = [0x5c6068, 0x4e535c, 0x6b6f76];

/** Props per chunk. Enough to feel inhabited without filling the water. */
const CORAL_PER_CHUNK = 14;
const ROCKS_PER_CHUNK = 9;
const KELP_PER_CHUNK = 11;

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

// -- prop builders -----------------------------------------------------------

/** A lumpy boulder. Rigid: flex stays at zero. */
function makeBoulder(rng: Rng): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;

  // Jitter each vertex so no two boulders are the same shape.
  for (let i = 0; i < position.count; i++) {
    const scale = 0.72 + rng() * 0.56;
    position.setXYZ(
      i,
      position.getX(i) * scale,
      position.getY(i) * scale * 0.72,
      position.getZ(i) * scale,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Branching coral: a few tapered spars fanning upward and outward.
 *
 * Built from stretched octahedra rather than cylinders — half the vertices,
 * and the faceting suits the low-poly look better than a smooth tube would.
 */
function makeCoral(rng: Rng): THREE.BufferGeometry {
  const branches: THREE.BufferGeometry[] = [];
  const count = 3 + Math.floor(rng() * 4);

  for (let i = 0; i < count; i++) {
    const branch = new THREE.OctahedronGeometry(1, 0);
    const height = randRange(rng, 0.9, 2.1);
    const thickness = randRange(rng, 0.16, 0.32);

    branch.scale(thickness, height, thickness);
    branch.translate(0, height, 0);

    // Fan outward: the further from centre, the more it leans.
    const lean = randRange(rng, 0.05, 0.5);
    const around = rng() * Math.PI * 2;
    branch.rotateX(Math.cos(around) * lean);
    branch.rotateZ(Math.sin(around) * lean);
    branch.translate(
      Math.sin(around) * randRange(rng, 0, 0.4),
      0,
      Math.cos(around) * randRange(rng, 0, 0.4),
    );

    branches.push(branch);
  }

  return mergeSimple(branches);
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

  geometry.dispose();
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
  const originX = cx * WORLD.chunkSize;
  const originZ = cz * WORLD.chunkSize;

  const acc: Accumulator = { positions: [], colors: [], flex: [], indices: [] };
  const pointsOfInterest: PointOfInterest[] = [];

  const color = new THREE.Color();
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const translation = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const normal = { x: 0, y: 1, z: 0 };

  /** Find a spot that is not on a cliff. Gives up rather than forcing it. */
  const findSpot = (): { x: number; z: number; y: number } | null => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const x = originX + rng() * WORLD.chunkSize;
      const z = originZ + rng() * WORLD.chunkSize;
      if (terrain.slopeAt(x, z) > MAX_SLOPE) continue;
      return { x, z, y: terrain.heightAt(x, z) };
    }
    return null;
  };

  const place = (
    geometry: THREE.BufferGeometry,
    spot: { x: number; z: number; y: number },
    size: number,
    tint: number,
    flexAt: (localY: number, maxY: number) => number,
    alignToSlope: boolean,
  ) => {
    if (alignToSlope) {
      terrain.normalAt(spot.x, spot.z, 1.5, normal);
      quaternion.setFromUnitVectors(up, new THREE.Vector3(normal.x, normal.y, normal.z));
    } else {
      quaternion.identity();
    }

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

  for (let i = 0; i < ROCKS_PER_CHUNK; i++) {
    const spot = findSpot();
    if (!spot) continue;
    place(
      makeBoulder(rng),
      { ...spot, y: spot.y - 0.25 },
      randRange(rng, 0.7, 2.6),
      ROCK_COLORS[Math.floor(rng() * ROCK_COLORS.length)]!,
      rigid,
      true,
    );
  }

  let coralPlaced = 0;
  for (let i = 0; i < CORAL_PER_CHUNK; i++) {
    const spot = findSpot();
    if (!spot) continue;
    place(
      makeCoral(rng),
      spot,
      randRange(rng, 0.55, 1.5),
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

  for (let i = 0; i < KELP_PER_CHUNK; i++) {
    const spot = findSpot();
    if (!spot) continue;
    place(
      makeKelp(rng),
      spot,
      randRange(rng, 0.8, 1.5),
      KELP_COLORS[Math.floor(rng() * KELP_COLORS.length)]!,
      kelpFlex,
      false,
    );
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
    flatShading: true,
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
