import * as THREE from "three";
import { WORLD } from "../core/config";
import type { PointOfInterest } from "../creatures/wander";
import { buildChunkDecor } from "./decor";
import type { Terrain } from "./terrain";

const VERTS_PER_EDGE = WORLD.chunkRes + 1;
const VERT_COUNT = VERTS_PER_EDGE * VERTS_PER_EDGE;
/** Padded grid includes a one-vertex border, used for cheap normal differences. */
const PAD_EDGE = VERTS_PER_EDGE + 2;

/**
 * Milliseconds of chunk building allowed per frame.
 *
 * A fixed count of chunks per frame was the wrong unit: measured on a 100Hz
 * display, two chunks cost 40ms in one frame — four dropped frames, roughly
 * every eight seconds of swimming. A time budget adapts to whatever the
 * machine can actually manage, and pairs with splitting each chunk into a
 * terrain pass and a decor pass so no single unit of work is large enough to
 * blow the frame on its own.
 *
 * At least one job always runs per frame, so streaming cannot stall no matter
 * how slow the hardware.
 */
const BUILD_BUDGET_MS = 5;

/** Chunk construction is split so neither half can monopolise a frame. */
const enum Stage {
  Terrain = 0,
  Decor = 1,
}

interface Job {
  cx: number;
  cz: number;
  stage: Stage;
}

/**
 * Floor palette, from trench bed up to sunlit reef top.
 *
 * Warm bright sand against saturated blue water is most of what makes the
 * shallows read as inviting rather than as a dim sea floor. The trench tone is
 * a cool blue-grey rather than mud, so depth again reads as bluer, not dirtier.
 */
const DEEP_SILT = new THREE.Color(0x3f6382);
const SILT = new THREE.Color(0x9cb96a);
const SAND = new THREE.Color(0xf0d99a);
// Darker than the sand it sits on, to put some value range back into a scene
// that otherwise drifts entirely into the mid-tones.
const ROCK = new THREE.Color(0x5f6b78);

interface Chunk {
  cx: number;
  cz: number;
  mesh: THREE.Mesh;
  /** All of this chunk's coral, rock and kelp, merged into one draw call. */
  decor: THREE.Mesh | null;
  pointsOfInterest: PointOfInterest[];
}

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/**
 * Streams the seabed around the swimmer.
 *
 * Chunks are built from world-space height samples, so neighbours agree along
 * shared edges by construction and there is no seam-stitching pass. Geometry is
 * pooled rather than disposed: swimming in one direction for an hour recycles
 * the same few dozen buffers instead of churning the allocator, which is what
 * keeps a long unattended session's memory flat.
 */
export class ChunkManager {
  private readonly chunks = new Map<string, Chunk>();
  private readonly pool: THREE.BufferGeometry[] = [];
  private readonly pending: Job[] = [];
  private readonly sharedIndex: THREE.BufferAttribute;
  private readonly heights = new Float32Array(PAD_EDGE * PAD_EDGE);

  private lastCx = Number.NaN;
  private lastCz = Number.NaN;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
    private readonly material: THREE.Material,
    private readonly decorMaterial: THREE.Material,
    private readonly worldSeed: number,
  ) {
    this.sharedIndex = ChunkManager.buildIndex();
  }

  /**
   * Feed the autopilot somewhere to drift toward.
   *
   * Only loaded chunks contribute, which is exactly right: the animal can only
   * be curious about scenery that actually exists near it.
   */
  collectPointsOfInterest(
    near: THREE.Vector3,
    radius: number,
    out: PointOfInterest[],
  ): void {
    const radiusSq = radius * radius;
    for (const chunk of this.chunks.values()) {
      for (const poi of chunk.pointsOfInterest) {
        if (poi.position.distanceToSquared(near) <= radiusSq) out.push(poi);
      }
    }
  }

  /** Live chunk count, for the perf overlay. Should plateau, never climb. */
  get liveCount(): number {
    return this.chunks.size;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  update(position: THREE.Vector3, immediate = false): void {
    const cx = Math.floor(position.x / WORLD.chunkSize);
    const cz = Math.floor(position.z / WORLD.chunkSize);

    if (cx !== this.lastCx || cz !== this.lastCz) {
      this.lastCx = cx;
      this.lastCz = cz;
      this.reconcile(cx, cz);
    }

    const deadline = performance.now() + BUILD_BUDGET_MS;

    while (this.pending.length > 0) {
      this.runJob(this.pending.shift()!);
      // Always complete one job before consulting the clock, so progress is
      // guaranteed even if a single job exceeds the whole budget.
      if (!immediate && performance.now() >= deadline) break;
    }
  }

  private runJob(job: Job): void {
    const key = chunkKey(job.cx, job.cz);

    if (job.stage === Stage.Terrain) {
      // The player may have moved on, or doubled back, before this ran.
      if (this.chunks.has(key)) return;
      this.buildTerrain(job.cx, job.cz);
      // Decor jumps the queue so a chunk finishes before the next one starts;
      // otherwise every chunk in range would appear as bare sand first and
      // then sprout its reef a moment later.
      this.pending.unshift({ cx: job.cx, cz: job.cz, stage: Stage.Decor });
      return;
    }

    const chunk = this.chunks.get(key);
    // Released again before its decor was built, or already has it.
    if (!chunk || chunk.decor) return;
    this.buildDecor(chunk);
  }

  /** Build everything in range right now. Used once, before the first frame. */
  primeAround(position: THREE.Vector3): void {
    this.update(position, true);
  }

  private reconcile(cx: number, cz: number): void {
    const r = WORLD.chunkRadius;

    // Queue anything newly in range, nearest first so the view fills outward.
    this.pending.length = 0;
    const wanted: Array<{ cx: number; cz: number; d: number }> = [];

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        if (this.chunks.has(chunkKey(x, z))) continue;
        wanted.push({ cx: x, cz: z, d: dx * dx + dz * dz });
      }
    }

    wanted.sort((a, b) => a.d - b.d);
    for (const item of wanted) {
      this.pending.push({ cx: item.cx, cz: item.cz, stage: Stage.Terrain });
    }

    // Release anything that has fallen out of range. The extra ring of
    // hysteresis stops a chunk thrashing when drifting along a boundary.
    const keepRadius = r + 1;
    for (const [key, chunk] of this.chunks) {
      if (
        Math.abs(chunk.cx - cx) > keepRadius ||
        Math.abs(chunk.cz - cz) > keepRadius
      ) {
        this.release(key, chunk);
      }
    }
  }

  private buildTerrain(cx: number, cz: number): void {
    const geometry = this.pool.pop() ?? this.createGeometry();
    const originX = cx * WORLD.chunkSize;
    const originZ = cz * WORLD.chunkSize;

    this.fillGeometry(geometry, originX, originZ);

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.position.set(originX, 0, originZ);
    // Receives the animal's shadow; casts nothing itself, because the seabed's
    // own relief is already described by the lighting and a second depth pass
    // over every chunk is the most expensive thing we could ask for here.
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    this.scene.add(mesh);

    this.chunks.set(chunkKey(cx, cz), {
      cx,
      cz,
      mesh,
      decor: null,
      pointsOfInterest: [],
    });
  }

  private buildDecor(chunk: Chunk): void {
    // Decor geometry varies in size per chunk, so unlike the terrain grid it is
    // not worth pooling; chunk turnover is measured in tens of seconds.
    const built = buildChunkDecor(this.worldSeed, chunk.cx, chunk.cz, this.terrain);
    if (!built) return;

    const decor = new THREE.Mesh(built.geometry, this.decorMaterial);
    decor.position.set(chunk.cx * WORLD.chunkSize, 0, chunk.cz * WORLD.chunkSize);
    decor.receiveShadow = true;
    decor.matrixAutoUpdate = false;
    decor.updateMatrix();

    this.scene.add(decor);

    chunk.decor = decor;
    chunk.pointsOfInterest = built.pointsOfInterest;
  }

  private release(key: string, chunk: Chunk): void {
    this.scene.remove(chunk.mesh);
    this.chunks.delete(key);
    // Terrain geometry goes back to the pool intact — only the data in its
    // buffers is rewritten when the slot is reused.
    this.pool.push(chunk.mesh.geometry as THREE.BufferGeometry);

    if (chunk.decor) {
      this.scene.remove(chunk.decor);
      chunk.decor.geometry.dispose();
    }
  }

  private createGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(VERT_COUNT * 3), 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(new Float32Array(VERT_COUNT * 3), 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(VERT_COUNT * 3), 3),
    );
    geometry.setIndex(this.sharedIndex);
    return geometry;
  }

  /**
   * Rewrite a geometry in place for a new chunk origin.
   *
   * Heights are sampled into a padded grid first so vertex normals come from
   * simple neighbour differences — roughly four times cheaper than calling the
   * terrain's own normal function per vertex, and identical in result.
   */
  private fillGeometry(
    geometry: THREE.BufferGeometry,
    originX: number,
    originZ: number,
  ): void {
    const step = WORLD.chunkSize / WORLD.chunkRes;

    for (let pz = 0; pz < PAD_EDGE; pz++) {
      const wz = originZ + (pz - 1) * step;
      for (let px = 0; px < PAD_EDGE; px++) {
        const wx = originX + (px - 1) * step;
        this.heights[pz * PAD_EDGE + px] = this.terrain.heightAt(wx, wz);
      }
    }

    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
    const color = geometry.getAttribute("color") as THREE.BufferAttribute;

    const posArray = position.array as Float32Array;
    const normArray = normal.array as Float32Array;
    const colorArray = color.array as Float32Array;

    const tint = new THREE.Color();

    for (let z = 0; z < VERTS_PER_EDGE; z++) {
      for (let x = 0; x < VERTS_PER_EDGE; x++) {
        const vi = z * VERTS_PER_EDGE + x;
        const pi = (z + 1) * PAD_EDGE + (x + 1);
        const h = this.heights[pi]!;

        posArray[vi * 3] = x * step;
        posArray[vi * 3 + 1] = h;
        posArray[vi * 3 + 2] = z * step;

        // Central differences on the padded grid.
        const hL = this.heights[pi - 1]!;
        const hR = this.heights[pi + 1]!;
        const hD = this.heights[pi - PAD_EDGE]!;
        const hU = this.heights[pi + PAD_EDGE]!;

        const nx = hL - hR;
        const ny = 2 * step;
        const nz = hD - hU;
        const len = Math.hypot(nx, ny, nz) || 1;

        normArray[vi * 3] = nx / len;
        normArray[vi * 3 + 1] = ny / len;
        normArray[vi * 3 + 2] = nz / len;

        // Elevation drives the palette: dark silt down in the trenches, sand
        // on the open flats, brightening toward the reef tops. Slope then
        // overrides it toward rock, because nothing settles on a wall.
        const slope = 1 - ny / len;
        const elevation = THREE.MathUtils.clamp(
          (h - (WORLD.seabedY - WORLD.colorSpanBelow)) /
            (WORLD.colorSpanBelow + WORLD.colorSpanAbove),
          0,
          1,
        );

        // The crossover sits low on the ramp deliberately: only genuine trench
        // beds should read as dark silt, with everything from the ordinary
        // floor upward carrying sand.
        if (elevation < 0.34) {
          tint
            .copy(DEEP_SILT)
            .lerp(SILT, THREE.MathUtils.smoothstep(elevation, 0.04, 0.34));
        } else {
          tint
            .copy(SILT)
            .lerp(SAND, THREE.MathUtils.smoothstep(elevation, 0.34, 0.78));
        }

        tint.lerp(ROCK, THREE.MathUtils.smoothstep(slope, 0.26, 0.68));

        colorArray[vi * 3] = tint.r;
        colorArray[vi * 3 + 1] = tint.g;
        colorArray[vi * 3 + 2] = tint.b;
      }
    }

    position.needsUpdate = true;
    normal.needsUpdate = true;
    color.needsUpdate = true;
    geometry.computeBoundingSphere();
  }

  private static buildIndex(): THREE.BufferAttribute {
    const quads = WORLD.chunkRes * WORLD.chunkRes;
    const indices = VERT_COUNT > 65535
      ? new Uint32Array(quads * 6)
      : new Uint16Array(quads * 6);

    let i = 0;
    for (let z = 0; z < WORLD.chunkRes; z++) {
      for (let x = 0; x < WORLD.chunkRes; x++) {
        const a = z * VERTS_PER_EDGE + x;
        const b = a + 1;
        const c = a + VERTS_PER_EDGE;
        const d = c + 1;

        indices[i++] = a;
        indices[i++] = c;
        indices[i++] = b;
        indices[i++] = b;
        indices[i++] = c;
        indices[i++] = d;
      }
    }

    return new THREE.BufferAttribute(indices, 1);
  }
}
