import { WORLD } from "../core/config";
import { fbm2 } from "./noise";

const SEED_MACRO = 0x9e3779b9;
const SEED_DETAIL = 0x2545f491;
const SEED_RIPPLE = 0x85ebca6b;
const SEED_TRENCH = 0xc2b2ae35;
const SEED_MOUND = 0x27d4eb2d;
const SEED_REEF = 0x165667b1;

/**
 * The seabed as a pure function of world position.
 *
 * Nothing caches, nothing is stored per chunk: `heightAt(x, z)` is the single
 * source of truth, used by the mesh builder, by decor placement, and by the
 * swimmer's collision clearance alike. Because chunks sample it at absolute
 * world coordinates, two neighbours compute byte-identical values along their
 * shared border and the seam closes itself.
 *
 * Six layers stack up, each doing a job the others cannot:
 *
 *   macro    broad basins and plateaus, so there are open flats
 *   base     the ordinary rolling relief
 *   detail   twenty-metre features that give the eye a sense of scale
 *   ripple   fine sand texture, only visible up close
 *   trench   ridged noise carved downward into winding canyons
 *   mound    raised reef structures standing above the floor
 *
 * The last two are what stop the ocean reading as one uniform slope — they
 * create somewhere to swim *into* and somewhere to swim *over*.
 */
export class Terrain {
  constructor(private readonly seed: number) {}

  heightAt(x: number, z: number): number {
    const f = WORLD.terrainFrequency;
    const amp = WORLD.terrainAmplitude;

    // Broad basins and plateaus.
    const macro = fbm2(x * f * 0.22, z * f * 0.22, this.seed ^ SEED_MACRO, 2);

    // Ordinary relief. Biasing toward its own square favours flats with
    // occasional ridges, which reads more like a seabed than raw noise does.
    const base = fbm2(x * f, z * f, this.seed, WORLD.terrainOctaves);
    const shaped = base * base * (3 - 2 * base);

    // Mid detail: without it the floor renders as a smooth blur with no sense
    // of scale. Fine ripple on top of that is the sand texture up close.
    const detail = fbm2(x * f * 3.4, z * f * 3.4, this.seed ^ SEED_DETAIL, 2);
    const ripple = fbm2(x * f * 9.5, z * f * 9.5, this.seed ^ SEED_RIPPLE, 2);

    let height =
      WORLD.seabedY +
      (shaped - 0.5) * amp +
      (macro - 0.5) * amp * 1.35 +
      (detail - 0.5) * amp * 0.42 +
      (ripple - 0.5) * amp * 0.16;

    // Trenches. Ridged noise — 1 - |2n - 1| — peaks along the contour where the
    // underlying field crosses its midpoint, which traces long connected lines
    // rather than blobs. Raising it to a high power narrows those lines into
    // canyons instead of valleys.
    // Frequency matters as much as depth here: at longer wavelengths a canyon
    // is wider than the fog distance, so you swim through one without ever
    // seeing it. These are tuned so a trench spans the visible view.
    const trenchField = fbm2(x * f * 0.72, z * f * 0.72, this.seed ^ SEED_TRENCH, 3);
    const ridge = 1 - Math.abs(trenchField * 2 - 1);
    height -= Math.pow(Math.max(0, ridge), 6) * WORLD.trenchDepth;

    // Reef mounds. Only the upper part of the field contributes, so these are
    // occasional landmarks rather than general bumpiness.
    const moundField = fbm2(x * f * 0.95, z * f * 0.95, this.seed ^ SEED_MOUND, 2);
    const mound = Math.max(0, moundField - 0.58) / 0.42;
    height += mound * mound * WORLD.moundHeight;

    return height;
  }

  /**
   * How reef-like this patch of seabed is, in [0, 1].
   *
   * Drives how thickly coral and kelp are scattered, so the world has dense
   * gardens and bare sand flats instead of an even sprinkle everywhere. This
   * is the difference between a generated floor and one that feels placed.
   */
  reefDensityAt(x: number, z: number): number {
    const f = WORLD.terrainFrequency;
    const field = fbm2(x * f * 0.45, z * f * 0.45, this.seed ^ SEED_REEF, 3);
    // Stretch the middle of the range so the transition between bare and lush
    // happens over a reasonable distance rather than switching abruptly.
    return Math.max(0, Math.min(1, (field - 0.34) / 0.42));
  }

  /**
   * Surface normal by central difference.
   *
   * Used to sit decor flush against slopes. `epsilon` is a little wider than
   * the mesh spacing so scattered props follow the visible surface rather than
   * chasing sub-vertex noise.
   */
  normalAt(x: number, z: number, epsilon = 1.5, out = { x: 0, y: 1, z: 0 }) {
    const hL = this.heightAt(x - epsilon, z);
    const hR = this.heightAt(x + epsilon, z);
    const hD = this.heightAt(x, z - epsilon);
    const hU = this.heightAt(x, z + epsilon);

    const nx = hL - hR;
    const ny = 2 * epsilon;
    const nz = hD - hU;
    const len = Math.hypot(nx, ny, nz) || 1;

    out.x = nx / len;
    out.y = ny / len;
    out.z = nz / len;
    return out;
  }

  /** Steepness in [0, 1]; 0 is flat, 1 is a wall. Keeps coral off cliffs. */
  slopeAt(x: number, z: number): number {
    const n = this.normalAt(x, z);
    return 1 - Math.max(0, Math.min(1, n.y));
  }
}
