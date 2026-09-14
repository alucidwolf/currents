import { WORLD } from "../core/config";
import { fbm2 } from "./noise";

/**
 * The seabed as a pure function of world position.
 *
 * Nothing caches, nothing is stored per chunk: `heightAt(x, z)` is the single
 * source of truth, used by the mesh builder, by decor placement, and by the
 * swimmer's collision clearance alike. Because chunks sample it at absolute
 * world coordinates, two neighbours compute byte-identical values along their
 * shared border and the seam closes itself.
 */
export class Terrain {
  constructor(private readonly seed: number) {}

  heightAt(x: number, z: number): number {
    const f = WORLD.terrainFrequency;

    // Base relief: broad, lazy hills.
    const base = fbm2(x * f, z * f, this.seed, WORLD.terrainOctaves);

    // A second, much slower layer carves out basins and plateaus, so the floor
    // is not uniformly bumpy — there are open sandy flats and raised reefs.
    const macro = fbm2(x * f * 0.22, z * f * 0.22, this.seed ^ 0x9e3779b9, 2);

    // A fine layer at roughly twenty-metre wavelength. Without it the floor
    // renders as a smooth blur with no sense of scale; this is what gives the
    // eye something to measure distance and speed against.
    const detail = fbm2(x * f * 3.4, z * f * 3.4, this.seed ^ 0x2545f491, 2);

    // Biasing the base toward its own square favours flats with occasional
    // ridges, which reads more like a seabed than symmetric noise does.
    const shaped = base * base * (3 - 2 * base);

    return (
      WORLD.seabedY +
      (shaped - 0.5) * WORLD.terrainAmplitude +
      (macro - 0.5) * WORLD.terrainAmplitude * 1.35 +
      (detail - 0.5) * WORLD.terrainAmplitude * 0.42
    );
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
