/**
 * Headless check that the animals are solid.
 *
 * Back faces are culled, so a hole in a body is not a missing patch of skin —
 * it is a window. Looking into one, you see straight through the hollow inside
 * and out the far side, because the far wall's faces point away from you and
 * are discarded. That is how a dolphin ends up showing you both of its eyes
 * from directly behind.
 *
 * It is also nearly impossible to catch by looking. The hole has to be pointed
 * at the camera before it shows, and every body here is built from a profile
 * callback, so whether the ends close is a property of a function's limit
 * rather than of anything visible in the shape. A tail that tapers to a
 * plausible-looking stock instead of to a point leaves a hole, and looks
 * completely correct from every angle except one.
 *
 * So: count edges used by exactly one triangle. A closed surface has none.
 *
 * Then check the surface is the right way out. Winding decides which faces get
 * culled, and a body wound inside-out is not obviously wrong to look at — for a
 * roughly convex shape you simply see the inside of the far wall, which has the
 * same silhouette and, since vertex colours travel with position, much the same
 * colouring. It gives itself away only through lost form and through every
 * detail on the far side showing through. The signed volume settles it: by the
 * divergence theorem a closed mesh wound outward encloses a positive volume,
 * and one wound inward encloses exactly the negative of it.
 *
 * Run with:  npm run verify:bodies
 */

import * as THREE from "three";
import { SPECIES } from "../src/creatures/species";
import { buildBody, buildFluke, buildFoil } from "../src/creatures/shapes";

interface Hole {
  edges: number;
  centre: [number, number, number];
  radius: number;
}

/** Edges belonging to exactly one triangle — the rim of a hole. */
function findHoles(geometry: THREE.BufferGeometry): Hole[] {
  const index = geometry.getIndex();
  if (!index) return [];

  const idx = index.array;
  const counts = new Map<number, number>();
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;

  // Key on welded position rather than vertex id: merged parts duplicate
  // vertices at identical coordinates, and two triangles meeting there are a
  // closed seam, not two rims.
  // Quantise to integer ticks rather than formatting. A profile that tapers to
  // zero lands its final ring on values like -6e-17, and `toFixed` renders
  // those as "-0.0000" — which does not match "0.0000", so half a collapsed
  // ring fails to weld and the nose reports a hole that is not there.
  const tick = (v: number) => {
    const r = Math.round(v * 1e4);
    return r === 0 ? 0 : r;
  };

  const weld = new Map<string, number>();
  const canonical = new Int32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const key =
      `${tick(position.getX(i))}_${tick(position.getY(i))}_${tick(position.getZ(i))}`;
    let id = weld.get(key);
    if (id === undefined) weld.set(key, (id = i));
    canonical[i] = id;
  }

  const bump = (a: number, b: number) => {
    const x = canonical[a]!;
    const y = canonical[b]!;
    if (x === y) return; // degenerate edge on a collapsed ring
    const key = x < y ? x * position.count + y : y * position.count + x;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  for (let i = 0; i < idx.length; i += 3) {
    const a = canonical[idx[i]!]!;
    const b = canonical[idx[i + 1]!]!;
    const c = canonical[idx[i + 2]!]!;

    // Skip triangles that collapsed to a line or a point. A body whose profile
    // tapers to zero emits a full ring of coincident vertices at the nose, and
    // the sliver triangles around it are degenerate rather than a hole — the
    // surface genuinely closes there.
    if (a === b || b === c || c === a) continue;

    bump(a, b);
    bump(b, c);
    bump(c, a);
  }

  const rim: number[] = [];
  for (const [key, n] of counts) {
    if (n !== 1) continue;
    rim.push(Math.floor(key / position.count), key % position.count);
  }
  if (rim.length === 0) return [];

  // Group rim vertices into separate holes by proximity, so the report names
  // each opening rather than one undifferentiated edge count.
  const points = [...new Set(rim)].map((i) => ({
    i,
    x: position.getX(i),
    y: position.getY(i),
    z: position.getZ(i),
  }));

  const holes: Hole[] = [];
  const claimed = new Set<number>();

  for (const seed of points) {
    if (claimed.has(seed.i)) continue;
    const group = [seed];
    claimed.add(seed.i);

    // Flood outward: anything within a generous radius of a claimed point is
    // the same opening.
    for (let head = 0; head < group.length; head++) {
      const from = group[head]!;
      for (const other of points) {
        if (claimed.has(other.i)) continue;
        const d = Math.hypot(other.x - from.x, other.y - from.y, other.z - from.z);
        if (d > 0.6) continue;
        claimed.add(other.i);
        group.push(other);
      }
    }

    const cx = group.reduce((s, p) => s + p.x, 0) / group.length;
    const cy = group.reduce((s, p) => s + p.y, 0) / group.length;
    const cz = group.reduce((s, p) => s + p.z, 0) / group.length;
    holes.push({
      edges: group.length,
      centre: [+cx.toFixed(2), +cy.toFixed(2), +cz.toFixed(2)],
      radius: +Math.max(
        ...group.map((p) => Math.hypot(p.x - cx, p.y - cy, p.z - cz)),
      ).toFixed(3),
    });
  }

  return holes.sort((a, b) => b.radius - a.radius);
}

/**
 * Volume enclosed by the surface, signed by its winding.
 *
 * Each triangle contributes the signed volume of the tetrahedron it forms with
 * the origin. Wound outward the contributions sum to the real volume; wound
 * inward, to its negative. Only meaningful once the mesh is closed.
 */
function signedVolume(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  if (!index) return 0;

  const idx = index.array;
  let total = 0;

  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]!;
    const b = idx[i + 1]!;
    const c = idx[i + 2]!;

    const ax = position.getX(a);
    const ay = position.getY(a);
    const az = position.getZ(a);
    const bx = position.getX(b);
    const by = position.getY(b);
    const bz = position.getZ(b);
    const cx = position.getX(c);
    const cy = position.getY(c);
    const cz = position.getZ(c);

    total +=
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx);
  }

  return total / 6;
}

/**
 * The shared builders, checked on their own.
 *
 * A merged animal hides a bad part: one inside-out flipper barely moves the
 * total volume of a whale, and an open fin root buried inside the body shows
 * nothing at all until the body around it is transparent for some other reason.
 * Mirrored parts are the specific trap — mirroring reverses winding, so a
 * builder that takes a side parameter gets one side right and the other exactly
 * backwards unless it compensates.
 */
const PRIMITIVES: Array<[string, () => THREE.BufferGeometry]> = [
  ["body tapered", () => buildBody({
    length: 4, segments: 12, radial: 12,
    radius: (t) => { const r = Math.sin(Math.PI * t) * 0.5; return { x: r, y: r * 0.8 }; },
  })],
  ["body blunt", () => buildBody({
    length: 4, segments: 12, radial: 12,
    // Open at both ends unless capped — the dolphin-tail case.
    radius: () => ({ x: 0.4, y: 0.3 }),
  })],
  ["foil +x", () => buildFoil({
    span: 1.2, spanAxis: "x", sign: 1, chord: (s) => 0.5 - 0.3 * s,
    sweep: (s) => -0.4 * s, thickness: (s) => 0.09 * (1 - 0.6 * s), rise: (s) => -0.2 * s,
  })],
  ["foil -x", () => buildFoil({
    span: 1.2, spanAxis: "x", sign: -1, chord: (s) => 0.5 - 0.3 * s,
    sweep: (s) => -0.4 * s, thickness: (s) => 0.09 * (1 - 0.6 * s), rise: (s) => -0.2 * s,
  })],
  ["foil +y", () => buildFoil({
    span: 0.9, spanAxis: "y", chord: (s) => 0.8 - 0.55 * s,
    sweep: (s) => -0.6 * s, thickness: (s) => 0.1 * (1 - 0.6 * s),
  })],
  ["fluke", () => buildFluke({
    halfSpan: 1.5, chordCentre: 0.9, sweep: 0.6,
    thickness: 0.14, notchDepth: 0.4, notchWidth: 0.16,
  })],
];

function checkPrimitives(): number {
  let failures = 0;

  for (const [name, build] of PRIMITIVES) {
    const geometry = build();
    const holes = findHoles(geometry);
    const volume = signedVolume(geometry);

    // Signed volume is translation-invariant for a coherently oriented closed
    // surface. If shifting the part changes it, some faces disagree with their
    // neighbours about which way is out.
    const moved = geometry.clone();
    moved.translate(17, 23, 31);
    const coherent = Math.abs(signedVolume(moved) - volume) < Math.abs(volume) * 1e-3 + 1e-6;

    if (holes.length === 0 && volume > 0 && coherent) {
      console.log(`  ${name.padEnd(14)} solid, ${volume.toFixed(4)}`);
      continue;
    }

    const why = [
      holes.length > 0 ? `${holes.length} hole(s)` : null,
      !coherent ? "faces disagree on which way is out" : null,
      coherent && volume <= 0 ? `inside-out (${volume.toFixed(4)})` : null,
    ].filter(Boolean);

    console.log(`  ${name.padEnd(14)} FAIL — ${why.join("; ")}`);
    for (const hole of holes.slice(0, 3)) {
      console.log(
        `                 at (${hole.centre.join(", ")}), rim radius ${hole.radius}, ${hole.edges} edges`,
      );
    }
    failures++;
  }

  return failures;
}

function main(): void {
  console.log("Animal bodies — solid, and the right way out\n");

  let failures = 0;

  console.log("shared builders");
  failures += checkPrimitives();
  console.log();

  for (const species of SPECIES) {
    const rig = species.build();
    const holes: Hole[] = [];
    let volume = 0;

    rig.root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry as THREE.BufferGeometry;
      holes.push(...findHoles(geometry));
      volume += signedVolume(geometry);
    });

    const problems: string[] = [];

    if (holes.length > 0) {
      const edges = holes.reduce((s, h) => s + h.edges, 0);
      problems.push(`${holes.length} hole(s), ${edges} open edges`);
    }
    // Only trust the orientation test on a closed surface: an open one encloses
    // nothing in particular and its signed volume means little.
    if (holes.length === 0 && volume <= 0) {
      problems.push(`wound inside-out (signed volume ${volume.toFixed(2)})`);
    }

    if (problems.length === 0) {
      console.log(`${species.id.padEnd(8)} solid, ${volume.toFixed(2)} m³`);
      continue;
    }

    console.log(`${species.id.padEnd(8)} FAIL — ${problems.join("; ")}`);
    for (const hole of holes.slice(0, 6)) {
      console.log(
        `         at (${hole.centre.join(", ")}), rim radius ${hole.radius}, ${hole.edges} edges`,
      );
    }
    if (holes.length > 6) console.log(`         ... and ${holes.length - 6} more`);
    failures++;
  }

  console.log();
  if (failures > 0) {
    console.log(
      `${failures} species can be seen through. Back faces are culled, so a hole ` +
        `is a window onto the inside of the animal and inverted winding hides ` +
        `the near wall entirely.`,
    );
    process.exit(1);
  }
  console.log("Every body is closed and facing outward.");
}

main();
