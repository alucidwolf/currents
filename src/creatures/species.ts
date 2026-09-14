import * as THREE from "three";
import {
  applyCountershading,
  buildBody,
  buildFin,
  buildWingDisc,
  mergeGeometries,
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
 */

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

// -- shared construction -----------------------------------------------------

interface CetaceanOptions {
  length: number;
  girth: number;
  height: number;
  color: number;
  belly: number;
  flukeSpan: number;
  pectoralSpan: number;
  dorsalHeight: number;
  beatSpeed: number;
  beatAmplitude: number;
}

/**
 * Whales and dolphins share a plan: a tapered body, a horizontal tail fluke,
 * swept pectorals and a dorsal ridge. Proportions do all the differentiating.
 *
 * Fins are baked into the body geometry rather than parented as children, so
 * the vertex wave flexes them along with everything else — the fluke ends up
 * with the largest displacement simply because it sits furthest back.
 */
function buildCetacean(options: CetaceanOptions): CreatureRig {
  const {
    length,
    girth,
    height,
    color,
    belly,
    flukeSpan,
    pectoralSpan,
    dorsalHeight,
    beatSpeed,
    beatAmplitude,
  } = options;

  const half = length / 2;

  const body = buildBody({
    length,
    segments: 18,
    radial: 9,
    radius(t) {
      // Peaks around 60% of the way toward the nose, closing to a point at
      // both ends. The exponent is what places the shoulder.
      const w = Math.sin(Math.PI * Math.pow(t, 1.35));
      return {
        x: 0.04 + Math.pow(w, 0.9) * girth,
        y: 0.03 + Math.pow(w, 0.9) * height,
      };
    },
  });

  const parts: THREE.BufferGeometry[] = [body];

  // Tail fluke: two blades reaching out sideways, flat to the water.
  for (const side of [1, -1]) {
    const fluke = buildFin({
      chordRoot: length * 0.17,
      chordTip: length * 0.07,
      span: flukeSpan,
      thickness: 0.09,
      sweep: length * 0.055,
      spanAxis: "x",
      sign: side,
    });
    parts.push(transformed(fluke, (m) => m.makeTranslation(0, 0, -half * 0.92)));
  }

  // Pectorals: set low on the flank and drooping slightly, as they hang at rest.
  for (const side of [1, -1]) {
    const pectoral = buildFin({
      chordRoot: length * 0.13,
      chordTip: length * 0.05,
      span: pectoralSpan,
      thickness: 0.07,
      sweep: length * 0.05,
      spanAxis: "x",
      sign: side,
    });
    transformed(pectoral, (m) => m.makeRotationZ(side * -0.22));
    parts.push(
      transformed(pectoral, (m) =>
        m.makeTranslation(side * girth * 0.72, -height * 0.32, length * 0.14),
      ),
    );
  }

  if (dorsalHeight > 0) {
    const dorsal = buildFin({
      chordRoot: length * 0.12,
      chordTip: length * 0.04,
      span: dorsalHeight,
      thickness: 0.07,
      sweep: length * 0.05,
      spanAxis: "y",
      sign: 1,
    });
    parts.push(
      transformed(dorsal, (m) => m.makeTranslation(0, height * 0.82, -length * 0.1)),
    );
  }

  const geometry = applyCountershading(mergeGeometries(parts), color, belly, 0.52);

  const swim = createSwimMaterial({
    // White base so the baked countershading carries the colour unmodified.
    color: 0xffffff,
    vertexColors: true,
    amplitude: beatAmplitude,
    wavelength: 2.6 / length,
    speed: beatSpeed,
    mode: "vertical",
    nose: half,
    length,
    onset: 0.22,
  });

  return rigFromSingleMesh(geometry, swim);
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
      geometry.dispose();
      swim.material.dispose();
    },
  };
}

// -- species -----------------------------------------------------------------

const whale: SpeciesDef = {
  id: "whale",
  name: "Humpback Whale",
  blurb: "Vast and unhurried. Turns like a continent.",
  speedScale: 0.86,
  turnScale: 0.62,
  viewDistance: 30,
  build() {
    return buildCetacean({
      length: 15,
      girth: 1.62,
      height: 1.86,
      // Backs are pushed darker than they "should" be: a sun directly overhead
      // lifts the upper surfaces hard, and without the extra margin the back
      // and belly converge to the same mid-grey and the shape stops reading.
      color: 0x1f2e40,
      belly: 0x9fb1b8,
      flukeSpan: 2.9,
      pectoralSpan: 3.4,
      dorsalHeight: 0.5,
      beatSpeed: 1.25,
      beatAmplitude: 0.62,
    });
  },
};

const dolphin: SpeciesDef = {
  id: "dolphin",
  name: "Dolphin",
  blurb: "Quick, curious, never quite still.",
  speedScale: 1.28,
  turnScale: 1.35,
  viewDistance: 15,
  build() {
    return buildCetacean({
      length: 6.4,
      girth: 0.62,
      height: 0.72,
      color: 0x3b4f63,
      belly: 0xc4d2da,
      flukeSpan: 1.25,
      pectoralSpan: 1.05,
      dorsalHeight: 0.78,
      beatSpeed: 3.1,
      beatAmplitude: 0.3,
    });
  },
};

const manta: SpeciesDef = {
  id: "manta",
  name: "Manta Ray",
  blurb: "All wing. Flies more than it swims.",
  speedScale: 0.98,
  turnScale: 0.95,
  viewDistance: 22,
  build() {
    const span = 9.2;
    const length = 7.4;

    const wings = buildWingDisc({
      span,
      length,
      thickness: 0.62,
      cols: 14,
      rows: 11,
    });

    const tail = transformed(
      buildBody({
        length: 5.4,
        segments: 8,
        radial: 6,
        radius(t) {
          // Thick where it meets the body, whipping down to nothing.
          return { x: 0.02 + t * 0.19, y: 0.02 + t * 0.19 };
        },
      }),
      (m) => m.makeTranslation(0, 0.06, -length * 0.5 - 2.3),
    );

    const geometry = applyCountershading(
      mergeGeometries([wings, tail]),
      0x1d232b,
      0xa9b6c2,
      0.48,
    );

    const swim = createSwimMaterial({
      color: 0xffffff,
      vertexColors: true,
      amplitude: 0.92,
      wavelength: 0.72,
      speed: 1.55,
      mode: "wing",
      nose: length / 2,
      length,
      span: span * 0.5,
    });

    return rigFromSingleMesh(geometry, swim);
  },
};

const turtle: SpeciesDef = {
  id: "turtle",
  name: "Sea Turtle",
  blurb: "Rows along in no particular hurry.",
  speedScale: 0.72,
  turnScale: 0.8,
  viewDistance: 13,
  build() {
    const shell = buildBody({
      length: 5.0,
      segments: 14,
      radial: 12,
      radius(t) {
        const w = Math.sin(Math.PI * Math.pow(t, 1.1));
        return { x: 0.05 + Math.pow(w, 0.62) * 2.15, y: 0.04 + Math.pow(w, 0.7) * 0.92 };
      },
    });

    const head = transformed(
      buildBody({
        length: 1.7,
        segments: 7,
        radial: 7,
        radius(t) {
          const w = Math.sin(Math.PI * Math.pow(t, 1.0));
          return { x: 0.05 + w * 0.36, y: 0.05 + w * 0.33 };
        },
      }),
      (m) => m.makeTranslation(0, -0.1, 3.0),
    );

    const geometry = applyCountershading(
      mergeGeometries([shell, head]),
      0x35411f,
      0xaaa877,
      0.42,
    );

    // The shell barely flexes; almost all the motion comes from the flippers.
    const swim = createSwimMaterial({
      color: 0xffffff,
      vertexColors: true,
      amplitude: 0.055,
      wavelength: 0.5,
      speed: 1.5,
      mode: "vertical",
      nose: 2.5,
      length: 5.0,
      onset: 0.5,
    });

    const root = new THREE.Group();
    const shellMesh = new THREE.Mesh(geometry, swim.material);
    shellMesh.frustumCulled = false;
    root.add(shellMesh);

    const flipperMaterial = new THREE.MeshLambertMaterial({
      color: 0x76854f,
      flatShading: true,
      // Flippers are thin and get seen from both sides as they row.
      side: THREE.DoubleSide,
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
      pivot.position.set(side * 1.15, -0.12, z);

      const blade = new THREE.Mesh(
        buildFin({
          chordRoot: chord,
          chordTip: chord * 0.42,
          span,
          thickness: 0.08,
          sweep: chord * 0.55,
          spanAxis: "x",
          sign: side,
        }),
        flipperMaterial,
      );
      blade.frustumCulled = false;

      pivot.add(blade);
      root.add(pivot);
      flippers.push({ pivot, phase, amplitude, side });
    };

    // Front pair does the rowing; the back pair mostly trails and steers.
    addFlipper(1, 1.35, 2.5, 1.15, 0, 0.62);
    addFlipper(-1, 1.35, 2.5, 1.15, Math.PI, 0.62);
    addFlipper(1, -1.5, 1.35, 0.8, Math.PI * 0.6, 0.26);
    addFlipper(-1, -1.5, 1.35, 0.8, Math.PI * 1.6, 0.26);

    return {
      root,
      update(elapsed, rate) {
        swim.setRate(rate);
        swim.setTime(elapsed);

        const beat = elapsed * 1.75 * rate;
        for (const flipper of flippers) {
          const wave = Math.sin(beat + flipper.phase);
          // Rowing, not flapping: the blade sweeps up and back, then feathers
          // on the return so it does not look like it is pushing both ways.
          flipper.pivot.rotation.z = wave * flipper.amplitude * flipper.side;
          flipper.pivot.rotation.y = Math.cos(beat + flipper.phase) * 0.22 * flipper.side;
        }
      },
      dispose() {
        geometry.dispose();
        swim.material.dispose();
        flipperMaterial.dispose();
      },
    };
  },
};

export const SPECIES: readonly SpeciesDef[] = [whale, turtle, manta, dolphin];

export function speciesById(id: string | null): SpeciesDef {
  return SPECIES.find((s) => s.id === id) ?? SPECIES[0]!;
}
