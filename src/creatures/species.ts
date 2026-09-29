import * as THREE from "three";
import {
  applyCountershading,
  attachDetails,
  buildBody,
  buildFluke,
  buildFoil,
  buildWingDisc,
  mergeGeometries,
  paintFacets,
  toFacets,
  transformed,
} from "./shapes";
import { createSwimMaterial } from "./swimShader";
import type { SwimMaterial } from "./swimShader";

/**
 * The four animals.
 *
 * Each is a merged geometry plus one deforming material, so a whole creature is
 * a single draw call. Only the turtle carries separate child meshes, because
 * rowing flippers cannot be expressed as a travelling wave along a body.
 *
 * These aim for a recognisable *silhouette* rather than recognisable anatomy:
 * a humpback's absurd pectorals, a dolphin's melon and beak, a ray's cephalic
 * fins, a turtle's domed shell. Those outlines are what the eye actually uses
 * to identify an animal, far more than polygon count does — which is what lets
 * the segment counts come down until every face can be seen and counted.
 *
 * Each animal is built to the same recipe: stout toy proportions, a big head,
 * oversized dot eyes and nothing else of a face, and four flat areas of colour
 * — a back, a cream belly, darker tips, and one accent that is the thing you
 * would name if you had to describe the animal in three words.
 */

/**
 * Form targets for the faceted look, from design-system/tokens.json.
 *
 * Multipliers apply to what the animals already were, so each keeps its own
 * character instead of converging on one shape.
 */
const FORM = {
  /** Radial segments on every swept body. Low counts are what make facets read. */
  radial: 9,
  /** Lengthwise segments. Twelve is the floor before the swim wave visibly kinks. */
  segments: 14,
  /** Chord segments on foils, flukes and the wing disc. */
  chord: 4,
  /** Eyes are tiny faceted beads, not spheres. */
  eyeSegments: 6,
  /** Eyes this much bigger, and nudged up and forward. The main cute lever. */
  eye: 1.8,
  /** The front third bulks up by this much. */
  head: 1.2,
  /** Bodies shorten by this much while keeping their height, so they read stout. */
  length: 0.82,
  /** Secondary fins shrink. Never the signature shape. */
  limb: 0.8,
} as const;

/** The cream underside every animal shares. */
const BELLY = 0xf3f1e6;

export interface CreatureRig {
  root: THREE.Group;
  /** `rate` scales the animation with cruise speed, so slowing looks slower. */
  update(elapsed: number, rate: number): void;
  dispose(): void;
}

export interface SpeciesDef {
  id: string;
  name: string;
  blurb: string;
  /** Multiplier on the global cruise speed. */
  speedScale: number;
  /** Multiplier on turn rates. Big animals turn lazily. */
  turnScale: number;
  /**
   * How far back the camera should sit. A fixed distance that frames a dolphin
   * nicely puts the camera inside a whale.
   */
  viewDistance: number;
  build(): CreatureRig;
}

const smooth = THREE.MathUtils.smoothstep;

const EYE = 0x131110;

/** A small dark eye. Cheap, and the single biggest gain in reading as alive. */
function eyeball(radius: number): THREE.BufferGeometry {
  return new THREE.SphereGeometry(radius, FORM.eyeSegments, 4);
}

/**
 * Eyes are placed as a mirrored pair on every animal.
 *
 * Bigger than life and set a little high and forward, which is the whole of
 * the face. There are no pupils, no catchlights, no brows and no mouth — a
 * solid dark bead reads as an animal looking at something, and anything added
 * to it starts reading as a cartoon instead.
 */
function eyePair(
  radius: number,
  x: number,
  y: number,
  z: number,
): Array<{ geometry: THREE.BufferGeometry; color: number }> {
  const r = radius * FORM.eye;
  return [1, -1].map((side) => ({
    geometry: transformed(eyeball(r), (m) =>
      m.makeTranslation(side * x, y + r * 0.45, z + r * 0.5),
    ),
    color: EYE,
  }));
}

/**
 * Bulk the front third of a body.
 *
 * Eased in rather than stepped, so the head is oversized without a collar
 * where it meets the rest. `t` runs 0 at the tail to 1 at the nose.
 */
function headBulk(t: number): number {
  return 1 + (FORM.head - 1) * smooth(t, 0.55, 0.94);
}

/**
 * Release every buffer and program hanging off a rig.
 *
 * Walks the tree rather than listing parts by hand. The species do not all
 * build the same way — a turtle is a shell plus four separately pivoted
 * flippers — and a hand-written list had already quietly missed the flipper
 * geometries. That cost nothing while an animal was chosen once at startup and
 * kept for the session; it became a leak on the frame animals could be swapped
 * mid-swim, which is the sort of thing a new feature turns from harmless into a
 * bug somewhere else entirely.
 */
function disposeTree(root: THREE.Object3D): void {
  const seen = new Set<THREE.Material | THREE.BufferGeometry>();

  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;

    if (mesh.geometry && !seen.has(mesh.geometry)) {
      seen.add(mesh.geometry);
      mesh.geometry.dispose();
    }

    // Shared between parts often enough to be worth the set.
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material && !seen.has(material)) {
        seen.add(material);
        material.dispose();
      }
    }
  });
}

function rigFromSingleMesh(
  geometry: THREE.BufferGeometry,
  swim: SwimMaterial,
): CreatureRig {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, swim.material);
  mesh.frustumCulled = false;
  root.add(mesh);

  return {
    root,
    update(elapsed, rate) {
      swim.setRate(rate);
      swim.setTime(elapsed);
    },
    dispose() {
      disposeTree(root);
    },
  };
}

/** Body bulk curve shared by the cetaceans: zero at both ends, peak forward. */
function bulkAt(t: number, skew = 1.3): number {
  return Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, skew))), 0.85);
}

// -- whale -------------------------------------------------------------------

const whale: SpeciesDef = {
  id: "whale",
  name: "Humpback Whale",
  blurb: "Vast and unhurried. Turns like a continent.",
  speedScale: 0.86,
  turnScale: 0.62,
  viewDistance: 30 * FORM.length,
  build() {
    const length = 15 * FORM.length;
    const girth = 1.66;
    const height = 1.92;
    const half = length / 2;

    const arch = (t: number) =>
      height * (0.1 * Math.sin(Math.PI * t) - 0.2 * smooth(t, 0.68, 1));

    const radiusAt = (t: number) => {
      const bulk = bulkAt(t);
      // The tail does not taper to a point — it ends in a peduncle, narrow
      // side to side but still deep top to bottom. That asymmetry is what
      // makes the tail stock read as muscle rather than as a spike.
      const stock = 1 - smooth(t, 0, 0.3);
      const head = headBulk(t);
      return {
        x: girth * (bulk + 0.055 * stock) * head,
        y: height * (bulk + 0.17 * stock) * head,
      };
    };

    const body = buildBody({
      length,
      segments: FORM.segments,
      radial: FORM.radial,
      radius: radiusAt,
      // Arched back through the middle, jaw hanging below the axis at the
      // front. A body symmetric about its own centreline reads as a tube.
      offsetY: arch,
      // Slab-sided amidships, rounding off toward both ends.
      sharpness: (t) => 2 + 0.55 * Math.sin(Math.PI * t),
    });

    const parts: THREE.BufferGeometry[] = [body];

    parts.push(
      transformed(
        buildFluke({
          halfSpan: 3.5,
          chordCentre: 2.35,
          sweep: 1.55,
          thickness: 0.3,
          notchDepth: 0.44,
          notchWidth: 0.15,
          chordSegments: FORM.chord,
        }),
        (m) => m.makeTranslation(0, 0, -half * 0.97),
      ),
    );

    // Pectorals. A humpback's are roughly a third of its body length, which
    // looks like a modelling error until you see a photograph — they are the
    // animal's most recognisable feature.
    for (const side of [1, -1]) {
      parts.push(
        transformed(
          buildFoil({
            // The signature shape, kept at full size while everything else
            // shrinks. Shrink this and it stops being a humpback.
            span: 4.9,
            spanAxis: "x",
            sign: side,
            stations: 6,
            chordSegments: FORM.chord,
            chord: (s) => 1.0 - 0.58 * Math.pow(s, 1.3),
            sweep: (s) => -0.85 * Math.pow(s, 1.55),
            thickness: (s) => 0.26 * (1 - 0.7 * s),
            // Droops from the shoulder, then sweeps back up at the tip.
            rise: (s) => -0.55 * s + 1.15 * Math.pow(s, 2.6),
          }),
          (m) => m.makeTranslation(side * girth * 0.56, -height * 0.3, length * 0.14),
        ),
      );
    }

    // Small dorsal, sitting on the characteristic hump.
    parts.push(
      transformed(
        buildFoil({
          span: 0.62 * FORM.limb,
          spanAxis: "y",
          stations: 4,
          chordSegments: FORM.chord,
          chord: (s) => 1.5 - 0.9 * s,
          sweep: (s) => -0.42 * s,
          thickness: (s) => 0.22 * (1 - 0.6 * s),
        }),
        (m) => m.makeTranslation(0, height * 0.88, -length * 0.06),
      ),
    );

    // Tubercles: the knobs along the rostrum. There used to be eighteen of
    // them, each under a tenth of a metre — individually invisible, together
    // unmistakable. At this scale of facet that reads as noise rather than as
    // knobs, so there are now four big ones down the centre of the head. Few
    // and large is the rule: a chunky thing with a few chunky lumps on it.
    for (let i = 0; i < 4; i++) {
      const t = 0.8 + (i / 3) * 0.16;
      const bulk = bulkAt(t);
      parts.push(
        transformed(new THREE.SphereGeometry(0.19, 5, 4), (m) =>
          m.makeTranslation(
            0,
            arch(t) + height * bulk * headBulk(t) * 0.88,
            -half + t * length,
          ),
        ),
      );
    }

    let geometry = applyCountershading(
      toFacets(mergeGeometries(parts)),
      0x3d7aa8,
      BELLY,
      0.5,
    );

    // Four flat areas and nothing else. The ventral pleats that used to run
    // along the throat are gone: fine parallel grooves are texture, and this
    // direction has none — at nine radial segments they aliased into noise
    // rather than reading as pleats.
    geometry = paintFacets(geometry, (x, y, z) => {
      // The pale pectorals, this animal's accent. A humpback's flippers are
      // startlingly white against the body, and that hard light/dark split is
      // the strongest graphic element it has — the same job a seabird's dark
      // primaries do, in reverse. A hard test, not a blend: the flipper is
      // pale right to its root.
      if (Math.abs(x) > 2.0 && z > 0.3 && z < 3.6) return 0xf3f1e6;

      // Darker tips: the trailing edge of the fluke, and the top of the hump.
      if (z < -half * 0.86) return 0x244e76;
      if (y > height * 0.74 && z > -length * 0.2 && z < length * 0.1) return 0x244e76;

      // The rostrum knobs, which are the head's one piece of detail.
      if (z > half * 0.56 && y > arch(0.85)) return 0x244e76;

      return null;
    });

    // Set into the flank rather than stuck on it: positioning against the
    // body's own radius at that station keeps only the outer cap proud of the
    // surface, wherever the profile happens to put it.
    const eyeT = 0.73;
    const eyeR = radiusAt(eyeT);
    geometry = attachDetails(
      geometry,
      eyePair(0.14, eyeR.x * 0.9, arch(eyeT) - eyeR.y * 0.45, -half + eyeT * length),
    );

    const swim = createSwimMaterial({
      color: 0xffffff,
      vertexColors: true,
      amplitude: 0.66,
      wavelength: 2.6 / length,
      speed: 0.6,
      mode: "vertical",
      nose: half,
      length,
      onset: 0.22,
    });

    return rigFromSingleMesh(geometry, swim);
  },
};

// -- dolphin -----------------------------------------------------------------

const dolphin: SpeciesDef = {
  id: "dolphin",
  name: "Dolphin",
  blurb: "Quick, curious, never quite still.",
  speedScale: 1.28,
  turnScale: 1.35,
  viewDistance: 15 * FORM.length,
  build() {
    const length = 6.6 * FORM.length;
    const girth = 0.6;
    const height = 0.7;
    const half = length / 2;

    // The melon and beak are the whole silhouette. Rather than closing the
    // body to a point at the nose, a slender rostrum term keeps a tube going
    // past where the main mass ends — so the forehead bulges and a distinct
    // snout runs out in front of it.
    const profile = (t: number) => {
      const body = Math.pow(
        Math.max(0, Math.sin(Math.PI * Math.pow(Math.min(t / 0.9, 1), 1.25))),
        0.8,
      );
      // The beak is a limb, and shrinks with the others; the melon behind it
      // does not, so shortening the snout makes the forehead read rounder.
      const rostrum =
        0.19 * FORM.limb * smooth(t, 0.7, 0.88) * (1 - smooth(t, 0.93, 1));
      const stock = 1 - smooth(t, 0, 0.26);
      return { core: body * 0.95 + rostrum, stock };
    };

    const radiusAt = (t: number) => {
      const { core, stock } = profile(t);
      const head = headBulk(t);
      return {
        x: girth * (core + 0.05 * stock) * head,
        y: height * (core + 0.15 * stock) * head,
      };
    };

    // Beak angles slightly downward off the melon.
    const droop = (t: number) =>
      height * (0.06 * Math.sin(Math.PI * t) - 0.34 * smooth(t, 0.86, 1));

    const body = buildBody({
      length,
      segments: FORM.segments,
      radial: FORM.radial,
      radius: radiusAt,
      offsetY: droop,
      sharpness: (t) => 2 + 0.35 * Math.sin(Math.PI * t),
    });

    const parts: THREE.BufferGeometry[] = [body];

    parts.push(
      transformed(
        buildFluke({
          halfSpan: 1.5,
          chordCentre: 0.92,
          sweep: 0.62,
          thickness: 0.14,
          notchDepth: 0.4,
          notchWidth: 0.16,
          spanStations: 5,
          chordSegments: FORM.chord,
        }),
        (m) => m.makeTranslation(0, 0, -half * 0.97),
      ),
    );

    // Falcate dorsal — the backswept scythe shape, not a shark's triangle.
    parts.push(
      transformed(
        buildFoil({
          span: 0.92 * FORM.limb,
          spanAxis: "y",
          stations: 5,
          chordSegments: FORM.chord,
          chord: (s) => 0.78 - 0.55 * Math.pow(s, 1.15),
          sweep: (s) => -0.62 * Math.pow(s, 1.35),
          thickness: (s) => 0.1 * (1 - 0.65 * s),
        }),
        (m) => m.makeTranslation(0, height * 0.86, -length * 0.02),
      ),
    );

    for (const side of [1, -1]) {
      parts.push(
        transformed(
          buildFoil({
            span: 1.15 * FORM.limb,
            spanAxis: "x",
            sign: side,
            stations: 5,
            chordSegments: FORM.chord,
            chord: (s) => 0.5 - 0.3 * Math.pow(s, 1.2),
            sweep: (s) => -0.42 * Math.pow(s, 1.4),
            thickness: (s) => 0.09 * (1 - 0.65 * s),
            rise: (s) => -0.2 * s,
          }),
          (m) => m.makeTranslation(side * girth * 0.6, -height * 0.34, length * 0.16),
        ),
      );
    }

    let geometry = applyCountershading(
      toFacets(mergeGeometries(parts)),
      0x6b8fb2,
      BELLY,
      0.48,
    );

    geometry = paintFacets(geometry, (_x, y, z) => {
      // The cape: the dark saddle sweeping back from the melon over the
      // shoulder. This animal's accent, and the third value between the cream
      // belly and the mid-tone back. A hard band now rather than a soft wash,
      // so it ends on a facet edge.
      if (y > 0.05 && z > -length * 0.06 && z < length * 0.34) return 0x47617f;

      // Darker tips on the dorsal, the fluke and the end of the beak.
      if (y > height * 0.8) return 0x3f5c7c;
      if (z < -half * 0.88) return 0x3f5c7c;
      if (z > half * 0.9) return 0x3f5c7c;

      return null;
    });

    const eyeT = 0.8;
    const eyeR = radiusAt(eyeT);
    geometry = attachDetails(
      geometry,
      eyePair(0.07, eyeR.x * 0.88, droop(eyeT) - eyeR.y * 0.32, -half + eyeT * length),
    );

    const swim = createSwimMaterial({
      color: 0xffffff,
      vertexColors: true,
      amplitude: 0.32,
      wavelength: 2.6 / length,
      speed: 1.45,
      mode: "vertical",
      nose: half,
      length,
      onset: 0.2,
    });

    return rigFromSingleMesh(geometry, swim);
  },
};

// -- manta -------------------------------------------------------------------

const manta: SpeciesDef = {
  id: "manta",
  name: "Manta Ray",
  blurb: "All wing. Flies more than it swims.",
  speedScale: 0.98,
  turnScale: 0.95,
  viewDistance: 22 * FORM.length,
  build() {
    // The wingspan is the signature and does not shrink. Only the body
    // shortens behind it, which makes the animal read as more wing still.
    const span = 9.4;
    const length = 7.6 * FORM.length;

    const wings = buildWingDisc({
      span,
      length,
      thickness: 0.66,
      cols: 12,
      rows: 9,
    });

    const parts: THREE.BufferGeometry[] = [wings];

    // Cephalic fins: the two forward-projecting lobes either side of the mouth.
    // Nothing else in the ocean has them, and without them a ray silhouette is
    // just a diamond.
    for (const side of [1, -1]) {
      const lobe = buildBody({
        length: 1.75 * FORM.limb,
        segments: 6,
        radial: FORM.radial,
        radius(t) {
          // Stubby and rounded rather than tapered: thick where it joins the
          // head and barely narrowing, so it reads as a blunt toy horn.
          const taper = 1 - smooth(t, 0.35, 1) * 0.4;
          return { x: 0.26 * taper, y: 0.32 * taper };
        },
      });
      // Splayed outward and angled slightly down, as they hang when cruising.
      lobe.rotateY(side * -0.34);
      lobe.rotateX(0.2);

      // Rooted where the wing still has width, not off the end of it.
      //
      // The disc is a diamond: `widthAt` is a sine that reaches zero at both
      // z extremes, so the front of the animal is a point. These used to be
      // anchored just past that point and got away with it, because at thirty
      // columns the taper was smooth enough to swallow them. At twelve, the
      // edge is a straight chord between two rows and cuts the corner — and
      // both lobes came away from the body and hung in the water beside it.
      parts.push(
        transformed(lobe, (m) =>
          m.makeTranslation(side * span * 0.05, -0.12, length * 0.42),
        ),
      );
    }

    // Whip tail.
    parts.push(
      transformed(
        buildBody({
          length: 5.6 * FORM.limb,
          segments: 7,
          radial: 6,
          radius(t) {
            const r = 0.02 + t * 0.2;
            return { x: r, y: r };
          },
        }),
        (m) => m.makeTranslation(0, 0.08, -length * 0.5 - 2.4),
      ),
    );

    let geometry = applyCountershading(
      toFacets(mergeGeometries(parts)),
      0x33587f,
      BELLY,
      0.46,
    );

    // The gill slits are gone with the pleats, and for the same reason: five
    // fine bars are texture, and there is none in this direction.
    geometry = paintFacets(geometry, (x, _y, z) => {
      // The outer fifth of each wing, as a hard band. The same graphic device
      // as a seabird's primaries — a clean dark edge that sharpens the
      // silhouette and stops a large flat animal reading as one shape.
      if (Math.abs(x) > span * 0.4) return 0x1d3349;

      // The cephalic lobes, this animal's accent: the two blunt horns either
      // side of the mouth that nothing else in the ocean has.
      if (z > length * 0.44 && Math.abs(x) < span * 0.14) return 0x3f6a94;

      return null;
    });

    // Set back from the nose for the same reason as the lobes: at this width
    // the wing is comfortably wider than the pair, so the eyes sit in the body
    // rather than beside it.
    geometry = attachDetails(
      geometry,
      eyePair(0.1, span * 0.1, -0.04, length * 0.34),
    );

    const swim = createSwimMaterial({
      color: 0xffffff,
      vertexColors: true,
      amplitude: 0.98,
      wavelength: 0.72,
      speed: 0.75,
      mode: "wing",
      nose: length / 2,
      length,
      span: span * 0.5,
    });

    return rigFromSingleMesh(geometry, swim);
  },
};

// -- turtle ------------------------------------------------------------------

const turtle: SpeciesDef = {
  id: "turtle",
  name: "Sea Turtle",
  blurb: "Rows along in no particular hurry.",
  speedScale: 0.72,
  turnScale: 0.8,
  viewDistance: 13 * FORM.length,
  build() {
    const shellLength = 5.2 * FORM.length;

    const shell = buildBody({
      length: shellLength,
      segments: FORM.segments,
      radial: FORM.radial,
      radius(t) {
        // Skewed forward so the carapace is a teardrop — broadest ahead of
        // centre, tapering to the rear — rather than a symmetric oval. Domed
        // higher than before: the shell is the signature, so it keeps its
        // height while the body under it shortens.
        const w = Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, 1.3))), 0.5);
        return { x: 0.05 + w * 2.25, y: 0.04 + Math.pow(w, 0.8) * 1.16 };
      },
      // Moderately full sections: enough to give the margin a defined edge,
      // not so much that it reads as a rounded box.
      sharpness: (t) => 2.15 + 0.7 * Math.sin(Math.PI * t),
    });

    // Flatten the plastron. A carapace domes above and is close to flat
    // beneath; a symmetric section makes the animal read as a ball, which is
    // the single thing that stops it looking like a turtle.
    const shellPos = shell.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < shellPos.count; i++) {
      const y = shellPos.getY(i);
      if (y < 0) shellPos.setY(i, y * 0.4);
    }
    shell.computeVertexNormals();

    // Neck and head, with a beaked snout.
    const head = transformed(
      buildBody({
        length: 2.1 * FORM.limb,
        segments: 8,
        radial: FORM.radial,
        radius(t) {
          // Slim neck, swelling to the skull, tapering to a hooked beak. The
          // skull takes the head bulk; a bigger head on a shorter neck is most
          // of what makes this one read as a toy.
          const neck = 0.26 + 0.22 * smooth(t, 0.05, 0.5);
          const skull = 1 - 0.62 * smooth(t, 0.62, 1);
          const head = headBulk(t);
          return { x: neck * skull * 1.05 * head, y: neck * skull * head };
        },
        offsetY: (t) => -0.06 * smooth(t, 0.5, 1),
        sharpness: () => 2.3,
      }),
      (m) => m.makeTranslation(0, -0.12, 2.95),
    );

    let geometry = applyCountershading(
      toFacets(mergeGeometries([shell, head])),
      0x74924e,
      0xdcd9a4,
      0.42,
    );

    /*
      Scutes, as whole groups of facets rather than as painted seams.

      The plates sit in a rough grid of latitude and longitude over the
      carapace. The old version darkened the seams of that grid, which was a
      fine trick while the shell was smooth — but a seam is a thin line, and a
      thin line drawn across chunky facets is exactly the texture this
      direction refuses. So the grid now decides which *cell* a face belongs
      to, and every face in a cell takes one colour. Alternating cells are
      darker, so the plates read as plates and each one is a few flat faces.
    */
    geometry = paintFacets(geometry, (x, y, z) => {
      // Carapace only: the head and the flat plastron are their own areas.
      if (y < -0.28 || z > shellLength * 0.44) return null;

      const radius = Math.hypot(x, z);
      if (radius < 0.25) return null;

      const longitude = Math.round(((Math.atan2(x, z) / Math.PI + 1) * 0.5) * 9);
      const latitude = Math.round((Math.atan2(y + 0.3, radius) / (Math.PI * 0.5)) * 3.4);

      // A checker over the plate grid: neighbours differ, so every seam is a
      // colour change between whole plates and never a drawn line.
      return (longitude + latitude) % 2 === 0 ? 0x4b6432 : null;
    });

    geometry = paintFacets(geometry, (_x, y, z) => {
      // The plastron, this animal's accent: the flat cream underside.
      if (y < -0.3 && z < shellLength * 0.44) return 0xdcd9a4;
      // Darker tip on the beak.
      if (z > shellLength * 0.66) return 0x4b6432;
      return null;
    });

    geometry = attachDetails(geometry, eyePair(0.08, 0.23, 0.02, 3.62 * FORM.length));

    // The shell barely flexes; almost all the motion comes from the flippers.
    const swim = createSwimMaterial({
      color: 0xffffff,
      vertexColors: true,
      amplitude: 0.055,
      wavelength: 0.5,
      speed: 0.55,
      mode: "vertical",
      nose: 2.6,
      length: shellLength,
      onset: 0.5,
    });

    const root = new THREE.Group();
    const shellMesh = new THREE.Mesh(geometry, swim.material);
    shellMesh.frustumCulled = false;
    root.add(shellMesh);

    const flipperMaterial = new THREE.MeshLambertMaterial({
      // Close to the carapace's own tone. Too far from it and the flippers
      // read as detached paddles rather than part of the animal.
      color: 0x6d8a4a,
      flatShading: true,
    });

    interface Flipper {
      pivot: THREE.Group;
      phase: number;
      amplitude: number;
      side: number;
    }

    const flippers: Flipper[] = [];

    const addFlipper = (
      side: number,
      z: number,
      span: number,
      chord: number,
      phase: number,
      amplitude: number,
    ) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 1.2, -0.14, z);

      const blade = new THREE.Mesh(
        buildFoil({
          span,
          spanAxis: "x",
          sign: side,
          stations: 5,
          chordSegments: FORM.chord,
          // Broad near the shoulder, tapering to a rounded paddle tip.
          chord: (s) => chord * (1 - 0.55 * Math.pow(s, 1.6)),
          sweep: (s) => -chord * 0.42 * Math.pow(s, 1.35),
          thickness: (s) => chord * 0.16 * (1 - 0.6 * s),
          rise: (s) => -0.1 * s,
        }),
        flipperMaterial,
      );
      blade.frustumCulled = false;

      pivot.add(blade);
      root.add(pivot);
      flippers.push({ pivot, phase, amplitude, side });
    };

    // Front pair does the rowing; the back pair mostly trails and steers.
    // Shortened with the other limbs, so the shell stays the whole animal.
    const fore = 2.7 * FORM.limb;
    const hind = 1.4 * FORM.limb;
    addFlipper(1, 1.4, fore, 1.2, 0, 0.48);
    addFlipper(-1, 1.4, fore, 1.2, Math.PI, 0.48);
    addFlipper(1, -1.55, hind, 0.85, Math.PI * 0.6, 0.2);
    addFlipper(-1, -1.55, hind, 0.85, Math.PI * 1.6, 0.2);

    return {
      root,
      update(elapsed, rate) {
        swim.setRate(rate);
        swim.setTime(elapsed);

        // Roughly one unhurried stroke every nine seconds. Nothing here should
        // look like effort.
        const beat = elapsed * 0.68 * rate;
        for (const flipper of flippers) {
          const wave = Math.sin(beat + flipper.phase);
          // Rowing, not flapping: the blade sweeps up and back, then feathers
          // on the return so it does not look like it is pushing both ways.
          flipper.pivot.rotation.z = wave * flipper.amplitude * flipper.side;
          flipper.pivot.rotation.y = Math.cos(beat + flipper.phase) * 0.13 * flipper.side;
        }
      },
      dispose() {
        disposeTree(root);
      },
    };
  },
};

export const SPECIES: readonly SpeciesDef[] = [whale, turtle, manta, dolphin];

export function speciesById(id: string | null): SpeciesDef {
  return SPECIES.find((s) => s.id === id) ?? SPECIES[0]!;
}
