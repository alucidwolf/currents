import * as THREE from "three";
import { SWIM, WORLD } from "../core/config";
import { mulberry32 } from "../core/rng";
import type { Rng } from "../core/rng";
import { buildBody } from "../creatures/shapes";
import type { PointOfInterest } from "../creatures/wander";
import type { Terrain } from "./terrain";

/**
 * Schools of small fish.
 *
 * Deliberately *not* boids. Real flocking means an O(n²) neighbour query every
 * frame and a pile of tuning to stop it either exploding or collapsing. At the
 * distances these are actually seen — always at least a few body lengths away,
 * usually through fog — a school moving along a smooth looping path with each
 * fish held at its own offset is indistinguishable from the real thing, and
 * costs a matrix compose per fish.
 *
 * All schools share one InstancedMesh, so the entire population of fish in the
 * world is a single draw call.
 */

const SCHOOL_COUNT = 5;
const FISH_PER_SCHOOL = 26;
const TOTAL = SCHOOL_COUNT * FISH_PER_SCHOOL;

/** Schools further than this from the swimmer are recycled ahead of it. */
const RECYCLE_DISTANCE = 210;
const SPAWN_MIN = 70;
const SPAWN_MAX = 150;

interface School {
  anchor: THREE.Vector3;
  /** Lissajous parameters, so each school loops on its own rhythm. */
  radius: number;
  speed: number;
  phase: number;
  wobble: number;
  heading: number;
  key: string;
  /** Per-fish offsets within the school. */
  offsets: THREE.Vector3[];
  phases: number[];
}

function buildFishGeometry(): THREE.BufferGeometry {
  // A proper tapered body rather than a stretched octahedron. Still tiny —
  // ten rings of eight — but it no longer reads as a shard when a school
  // passes close by.
  const body = buildBody({
    length: 1,
    segments: 10,
    radial: 8,
    radius(t) {
      const w = Math.sin(Math.PI * Math.pow(t, 1.25));
      return { x: 0.02 + w * 0.17, y: 0.02 + w * 0.22 };
    },
  });
  body.scale(1, 1, 0.85);

  const tail = new THREE.BufferGeometry();
  tail.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [0, 0, -0.36, 0, 0.2, -0.62, 0, -0.2, -0.62],
      3,
    ),
  );
  tail.setIndex([0, 1, 2]);

  const positions: number[] = [];
  const indices: number[] = [];
  let offset = 0;

  for (const part of [body, tail]) {
    const pos = part.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    const index = part.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + offset);
    }
    offset += pos.count;
    part.dispose();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export class FishSchools {
  private readonly mesh: THREE.InstancedMesh;
  private readonly schools: School[] = [];
  private readonly rng: Rng;

  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly previous = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly forward = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly centre = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();

  private nextKey = 0;

  constructor(
    scene: THREE.Scene,
    private readonly terrain: Terrain,
    seed: number,
    swimmerPosition: THREE.Vector3,
  ) {
    this.rng = mulberry32(seed ^ 0x4f1bbcdd);

    const material = new THREE.MeshLambertMaterial({
      color: 0xd9b26a,
      flatShading: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.InstancedMesh(buildFishGeometry(), material, TOTAL);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    for (let i = 0; i < SCHOOL_COUNT; i++) {
      this.schools.push(this.makeSchool(swimmerPosition));
    }
  }

  private makeSchool(near: THREE.Vector3): School {
    const rng = this.rng;
    const angle = rng() * Math.PI * 2;
    const distance = SPAWN_MIN + rng() * (SPAWN_MAX - SPAWN_MIN);

    const x = near.x + Math.sin(angle) * distance;
    const z = near.z + Math.cos(angle) * distance;

    // Sit the school in open water: above the seabed, below the surface.
    const floor = this.terrain.heightAt(x, z);
    const ceiling = WORLD.surfaceY - SWIM.surfaceClearance - 4;
    const y = Math.min(floor + 9 + rng() * 16, ceiling);

    const offsets: THREE.Vector3[] = [];
    const phases: number[] = [];
    const spread = 3.2 + rng() * 3.4;

    for (let i = 0; i < FISH_PER_SCHOOL; i++) {
      offsets.push(
        new THREE.Vector3(
          (rng() - 0.5) * spread * 2,
          (rng() - 0.5) * spread,
          (rng() - 0.5) * spread * 2.4,
        ),
      );
      phases.push(rng() * Math.PI * 2);
    }

    return {
      anchor: new THREE.Vector3(x, y, z),
      radius: 9 + rng() * 16,
      speed: 0.1 + rng() * 0.16,
      phase: rng() * Math.PI * 2,
      wobble: 0.5 + rng() * 1.1,
      heading: 0,
      key: `school:${this.nextKey++}`,
      offsets,
      phases,
    };
  }

  collectPointsOfInterest(
    near: THREE.Vector3,
    radius: number,
    out: PointOfInterest[],
  ): void {
    const radiusSq = radius * radius;
    for (const school of this.schools) {
      if (school.anchor.distanceToSquared(near) <= radiusSq) {
        out.push({
          key: school.key,
          position: school.anchor,
          // Fish outrank coral: something alive is worth more of a detour.
          weight: 1.8,
        });
      }
    }
  }

  update(elapsed: number, swimmerPosition: THREE.Vector3): void {
    let instance = 0;

    for (const school of this.schools) {
      // Recycle a school that has been left far behind, respawning it somewhere
      // ahead. A new key means the autopilot may find it interesting again.
      if (school.anchor.distanceTo(swimmerPosition) > RECYCLE_DISTANCE) {
        const replacement = this.makeSchool(swimmerPosition);
        Object.assign(school, replacement);
      }

      const t = elapsed * school.speed + school.phase;

      // A Lissajous loop: never quite repeating, always smooth.
      this.centre.set(
        school.anchor.x + Math.sin(t) * school.radius,
        school.anchor.y + Math.sin(t * school.wobble) * 3.4,
        school.anchor.z + Math.cos(t * 1.31) * school.radius,
      );

      // Facing comes from where the centre was a moment ago, which is both
      // free and exactly correct.
      this.previous.set(
        school.anchor.x + Math.sin(t - 0.08) * school.radius,
        school.anchor.y + Math.sin((t - 0.08) * school.wobble) * 3.4,
        school.anchor.z + Math.cos((t - 0.08) * 1.31) * school.radius,
      );

      this.forward.copy(this.centre).sub(this.previous);
      if (this.forward.lengthSq() < 1e-8) this.forward.set(0, 0, 1);
      this.forward.normalize();

      // Matrix4.lookAt builds its Z axis as (eye - target), and a mesh's local
      // +Z is its nose — so putting the eye at `forward` and the target at the
      // origin aims the fish straight down its direction of travel.
      this.matrix.lookAt(this.forward, this.origin, this.up);
      this.quaternion.setFromRotationMatrix(this.matrix);

      // Keep the whole school clear of the seabed as it loops.
      const floor = this.terrain.heightAt(this.centre.x, this.centre.z) + 4;
      if (this.centre.y < floor) this.centre.y = floor;

      for (let i = 0; i < FISH_PER_SCHOOL; i++) {
        const offset = school.offsets[i]!;
        const wiggle = Math.sin(elapsed * 1.5 + school.phases[i]!) * 0.2;

        this.position
          .copy(offset)
          .applyQuaternion(this.quaternion)
          .add(this.centre);
        this.position.y += wiggle;

        this.matrix.compose(this.position, this.quaternion, this.scale);
        this.mesh.setMatrixAt(instance++, this.matrix);
      }
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
