/**
 * Headless survey of what actually grows on the seabed.
 *
 * Clustering is hard to judge from a screenshot: a single view shows you one
 * reef, and cannot tell you whether the rest of the ocean is reefs or an even
 * sprinkle. Worse, the failure mode of a clustering scheme is statistical —
 * colonies too small, too frequent, or too evenly spaced all look fine close up
 * and wrong from above.
 *
 * So this walks a large block of chunks, builds the real decor for each, and
 * reports the distribution. It also serves as the performance guard: prop and
 * triangle counts per chunk are what the streaming budget has to absorb.
 *
 * Run with:  npm run verify:reef
 */

import { WORLD } from "../src/core/config";
import { ColonyKind, PropKind, collectColonies } from "../src/world/colonies";
import { buildChunkDecor } from "../src/world/decor";
import { Terrain } from "../src/world/terrain";

const SEEDS = [0x1234, 0xbeef, 0x5eed, 0xa11ce, 0x0cea2];
/** Chunks per side surveyed per seed. 24 x 24 is about 2.4 square kilometres. */
const SPAN = 24;

interface Survey {
  seed: number;
  chunks: number;
  colonies: number;
  landmarks: number;
  props: number;
  structures: number;
  bareChunks: number;
  maxPropsInChunk: number;
  kinds: Record<string, number>;
  /** Share of sampled ground that carries no prop within 12 units. */
  openGround: number;
  triangles: number;
  maxTrianglesInChunk: number;
}

function survey(seed: number): Survey {
  const terrain = new Terrain(seed);

  let colonies = 0;
  let landmarks = 0;
  let props = 0;
  let structures = 0;
  let bareChunks = 0;
  let maxPropsInChunk = 0;
  let triangles = 0;
  let maxTrianglesInChunk = 0;

  const kinds: Record<string, number> = { reef: 0, kelp: 0, rubble: 0 };
  const positions: Array<{ x: number; z: number }> = [];

  for (let cz = 0; cz < SPAN; cz++) {
    for (let cx = 0; cx < SPAN; cx++) {
      const { members, sites } = collectColonies(seed, cx, cz, terrain);

      colonies += sites.length;
      for (const site of sites) {
        if (site.landmark) landmarks++;
        if (site.kind === ColonyKind.Reef) kinds.reef!++;
        else if (site.kind === ColonyKind.KelpBed) kinds.kelp!++;
        else kinds.rubble!++;
      }

      props += members.length;
      for (const member of members) {
        if (member.prop === PropKind.Structure) structures++;
        // Sampled sparsely; the open-ground measure only needs the shape of the
        // distribution, and holding every prop in the world would not fit.
        if (positions.length < 40000 && member.x % 3 < 1) {
          positions.push({ x: member.x, z: member.z });
        }
      }

      if (members.length === 0) bareChunks++;
      maxPropsInChunk = Math.max(maxPropsInChunk, members.length);

      // Build the real geometry for a sample of chunks: it is the only honest
      // source for the triangle count, and it exercises the merge path.
      if ((cx + cz) % 6 === 0) {
        const built = buildChunkDecor(seed, cx, cz, terrain);
        const tris = built ? built.geometry.getIndex()!.count / 3 : 0;
        triangles += tris;
        maxTrianglesInChunk = Math.max(maxTrianglesInChunk, tris);
        built?.geometry.dispose();
      }
    }
  }

  const builtChunks = Math.ceil((SPAN * SPAN) / 6);

  return {
    seed,
    chunks: SPAN * SPAN,
    colonies,
    landmarks,
    props,
    structures,
    bareChunks,
    maxPropsInChunk,
    kinds,
    openGround: openGroundShare(positions, terrain),
    triangles: triangles / builtChunks,
    maxTrianglesInChunk,
  };
}

/**
 * How much of the seabed is genuinely open.
 *
 * This is the number that separates clustering from a sprinkle. An even
 * scatter at the same overall density leaves almost no point far from a prop;
 * clustering concentrates the same props and opens real space between them.
 */
function openGroundShare(
  positions: Array<{ x: number; z: number }>,
  terrain: Terrain,
): number {
  if (positions.length === 0) return 1;

  // Bucket into a grid so the nearest-prop test stays linear.
  const CELL = 16;
  const grid = new Map<string, Array<{ x: number; z: number }>>();
  for (const p of positions) {
    const key = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
    let bucket = grid.get(key);
    if (!bucket) grid.set(key, (bucket = []));
    bucket.push(p);
  }

  const SAMPLES = 4000;
  const extent = SPAN * WORLD.chunkSize;
  let open = 0;
  let counted = 0;

  for (let i = 0; i < SAMPLES; i++) {
    // A deterministic lattice with an irrational stride: even coverage without
    // needing a generator, and no alignment with the chunk grid.
    const x = ((i * 0.6180339887) % 1) * extent;
    const z = ((i * 0.7548776662) % 1) * extent;

    // Only measure ground props could actually occupy; a cliff face being bare
    // says nothing about clustering.
    if (terrain.slopeAt(x, z) > 0.55) continue;
    counted++;

    const gx = Math.floor(x / CELL);
    const gz = Math.floor(z / CELL);
    let nearest = Infinity;

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = grid.get(`${gx + dx},${gz + dz}`);
        if (!bucket) continue;
        for (const p of bucket) {
          nearest = Math.min(nearest, Math.hypot(p.x - x, p.z - z));
        }
      }
    }

    if (nearest > 12) open++;
  }

  return counted === 0 ? 1 : open / counted;
}

function main(): void {
  console.log("Seabed survey\n");

  const results = SEEDS.map(survey);
  let failures = 0;

  for (const r of results) {
    const perChunk = (n: number) => (n / r.chunks).toFixed(2);
    console.log(`seed ${r.seed.toString(16)}`);
    console.log(
      `  colonies      ${r.colonies} (${perChunk(r.colonies)}/chunk)  ` +
        `reef ${r.kinds.reef} / kelp ${r.kinds.kelp} / rubble ${r.kinds.rubble}`,
    );
    console.log(
      `  structures    ${r.structures} (1 per ${(r.chunks / Math.max(1, r.structures)).toFixed(1)} chunks)`,
    );
    console.log(
      `  props         ${r.props} (${perChunk(r.props)}/chunk, peak ${r.maxPropsInChunk})`,
    );
    console.log(
      `  bare chunks   ${r.bareChunks} (${((r.bareChunks / r.chunks) * 100).toFixed(1)}%)`,
    );
    console.log(`  open ground   ${(r.openGround * 100).toFixed(1)}%`);
    console.log(
      `  triangles     ${Math.round(r.triangles)}/chunk avg, ${Math.round(r.maxTrianglesInChunk)} peak`,
    );

    // Guards. These are the boundaries either side of "clustered": too few
    // colonies and the ocean is empty, too many and it is the sprinkle again.
    const check = (ok: boolean, message: string) => {
      if (!ok) {
        console.log(`  FAIL: ${message}`);
        failures++;
      }
    };

    check(r.colonies / r.chunks > 0.7, "too few colonies — the seabed will read as empty");
    check(r.colonies / r.chunks < 3.2, "too many colonies — clusters will merge back into a sprinkle");
    check(r.structures / r.chunks > 0.1, "large structures too rare to shape the view");
    check(r.openGround > 0.35, "not enough open ground — props are spread, not clustered");
    check(r.openGround < 0.9, "too much open ground — the ocean is barren");
    check(r.maxTrianglesInChunk < 40000, "a chunk is heavy enough to threaten the frame budget");
    console.log();
  }

  if (failures > 0) {
    console.log(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("All checks passed.");
}

main();
