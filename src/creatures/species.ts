import * as THREE from "three";
import {
  applyCountershading,
  attachDetails,
  buildBody,
  buildFluke,
  buildFoil,
  buildWingDisc,
  mergeGeometries,
  overlayPattern,
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
 * These aim for recognisable anatomy rather than generic sea-creature
 * outlines: a humpback's absurd pectorals and knobbled rostrum, a dolphin's
 * melon and beak, a ray's cephalic fins, a turtle's scutes. Those specifics are
 * what the eye actually uses to identify an animal — far more than polygon
 * count — but they only hold up close if the surfaces beneath them are smooth,
 * which is what the raised segment counts are for.
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

const smooth = THREE.MathUtils.smoothstep;

const EYE = 0x131110;

/** A small dark eye. Cheap, and the single biggest gain in reading as alive. */
function eyeball(radius: number): THREE.BufferGeometry {
  return new THREE.SphereGeometry(radius, 10, 8);
}

/** Eyes are placed as a mirrored pair on every animal. */
function eyePair(
  radius: number,
  x: number,
  y: number,
  z: number,
): Array<{ geometry: THREE.BufferGeometry; color: number }> {
  return [1, -1].map((side) => ({
    geometry: transformed(eyeball(radius), (m) => m.makeTranslation(side * x, y, z)),
    color: EYE,
  }));
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
  viewDistance: 30,
  build() {
    const length = 15;
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
      return {
        x: girth * (bulk + 0.055 * stock),
        y: height * (bulk + 0.17 * stock),
      };
    };

    const body = buildBody({
      length,
      segments: 46,
      radial: 22,
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
            span: 4.9,
            spanAxis: "x",
            sign: side,
            stations: 12,
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
          span: 0.62,
          spanAxis: "y",
          stations: 6,
          chord: (s) => 1.5 - 0.9 * s,
          sweep: (s) => -0.42 * s,
          thickness: (s) => 0.22 * (1 - 0.6 * s),
        }),
        (m) => m.makeTranslation(0, height * 0.88, -length * 0.06),
      ),
    );

    // Tubercles: the knobs along the rostrum and jaw. Each is under a tenth of
    // a metre and individually invisible; collectively unmistakable.
    for (let i = 0; i < 18; i++) {
      const t = 0.78 + (i / 17) * 0.2;
      const lane = i % 3;
      const bulk = bulkAt(t);
      const z = -half + t * length;
      const radius = lane === 0 ? 0.1 : 0.075;
      const spread = lane === 0 ? 0 : (lane === 1 ? 1 : -1) * girth * bulk * 0.74;
      const lift = arch(t) + height * bulk * (lane === 0 ? 0.92 : 0.34);

      parts.push(
        transformed(new THREE.SphereGeometry(radius, 7, 6), (m) =>
          m.makeTranslation(spread, lift, z),
        ),
      );
    }

    let geometry = applyCountershading(mergeGeometries(parts), 0x3d7aa8, 0xe9f1f3, 0.5);

    geometry = overlayPattern(geometry, (x, y, z) => {
      // White pectorals. A humpback's flippers are startlingly pale against
      // the body, and that hard light/dark split is the strongest graphic
      // element the animal has — the same job the dark primaries do on a
      // bird's wing, in reverse.
      const pectoral =
        smooth(Math.abs(x), 1.8, 2.8) * smooth(z, 0.2, 1.0) * (1 - smooth(z, 2.8, 3.6));
      if (pectoral > 0.01) return 1 + pectoral * 2.4;

      // Ventral pleats: the long grooves running back from the jaw along the
      // throat. Shading rather than geometry — at any distance you actually
      // see this animal, the difference is not perceptible.
      const throat = smooth(z, -length * 0.04, length * 0.3) * smooth(-y, 0.15, 1.2);
      if (throat <= 0.01) return 1;
      const phase = x * 3.4;
      const groove = phase - Math.floor(phase);
      const edge = Math.min(groove, 1 - groove);
      return 1 - throat * (1 - smooth(edge, 0.05, 0.24)) * 0.34;
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
  viewDistance: 15,
  build() {
    const length = 6.6;
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
      const rostrum = 0.19 * smooth(t, 0.7, 0.88) * (1 - smooth(t, 0.93, 1));
      const stock = 1 - smooth(t, 0, 0.26);
      return { core: body * 0.95 + rostrum, stock };
    };

    const radiusAt = (t: number) => {
      const { core, stock } = profile(t);
      return {
        x: girth * (core + 0.05 * stock),
        y: height * (core + 0.15 * stock),
      };
    };

    // Beak angles slightly downward off the melon.
    const droop = (t: number) =>
      height * (0.06 * Math.sin(Math.PI * t) - 0.34 * smooth(t, 0.86, 1));

    const body = buildBody({
      length,
      segments: 44,
      radial: 20,
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
        }),
        (m) => m.makeTranslation(0, 0, -half * 0.97),
      ),
    );

    // Falcate dorsal — the backswept scythe shape, not a shark's triangle.
    parts.push(
      transformed(
        buildFoil({
          span: 0.92,
          spanAxis: "y",
          stations: 9,
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
            span: 1.15,
            spanAxis: "x",
            sign: side,
            stations: 9,
            chord: (s) => 0.5 - 0.3 * Math.pow(s, 1.2),
            sweep: (s) => -0.42 * Math.pow(s, 1.4),
            thickness: (s) => 0.09 * (1 - 0.65 * s),
            rise: (s) => -0.2 * s,
          }),
          (m) => m.makeTranslation(side * girth * 0.6, -height * 0.34, length * 0.16),
        ),
      );
    }

    let geometry = applyCountershading(mergeGeometries(parts), 0x6b8fb2, 0xf3f8fa, 0.48);

    // The dark cape sweeping back from the melon over the shoulder — a
    // standard dolphin marking, and a second value step between the light
    // belly and the mid-tone back.
    geometry = overlayPattern(geometry, (_x, y, z) => {
      const cape = smooth(z, -length * 0.1, length * 0.34) * smooth(y, -0.1, 0.35);
      return 1 - cape * 0.34;
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
  viewDistance: 22,
  build() {
    const span = 9.4;
    const length = 7.6;

    const wings = buildWingDisc({
      span,
      length,
      thickness: 0.66,
      cols: 30,
      rows: 22,
    });

    const parts: THREE.BufferGeometry[] = [wings];

    // Cephalic fins: the two forward-projecting lobes either side of the mouth.
    // Nothing else in the ocean has them, and without them a ray silhouette is
    // just a diamond.
    for (const side of [1, -1]) {
      const lobe = buildBody({
        length: 1.75,
        segments: 12,
        radial: 10,
        radius(t) {
          // Thick where it joins the head, rolled to a blunt tip.
          const taper = 1 - smooth(t, 0.15, 1) * 0.72;
          return { x: 0.2 * taper, y: 0.26 * taper };
        },
      });
      // Splayed outward and angled slightly down, as they hang when cruising.
      lobe.rotateY(side * -0.34);
      lobe.rotateX(0.2);

      parts.push(
        transformed(lobe, (m) =>
          m.makeTranslation(side * span * 0.085, -0.12, length * 0.5 + 0.5),
        ),
      );
    }

    // Whip tail.
    parts.push(
      transformed(
        buildBody({
          length: 5.6,
          segments: 18,
          radial: 8,
          radius(t) {
            const r = 0.02 + t * 0.2;
            return { x: r, y: r };
          },
        }),
        (m) => m.makeTranslation(0, 0.08, -length * 0.5 - 2.4),
      ),
    );

    let geometry = applyCountershading(mergeGeometries(parts), 0x33587f, 0xdfecf3, 0.46);

    geometry = overlayPattern(geometry, (x, y, z) => {
      // Darkened wingtips. The same graphic device as a seabird's primaries:
      // a clean dark band at the extremity that sharpens the silhouette and
      // stops a large flat animal reading as one undifferentiated shape.
      const tip = smooth(Math.abs(x), span * 0.3, span * 0.49) * 0.42;

      // Gill slits: five dark bars either side of the underside, behind the
      // mouth. Only visible from below, which is exactly when you want them.
      if (y > -0.02) return 1 - tip;
      const band = smooth(z, -length * 0.1, length * 0.3) * smooth(Math.abs(x), 0.3, 1.5);
      if (band <= 0.01) return 1 - tip;
      const phase = z * 2.6;
      const slit = phase - Math.floor(phase);
      const edge = Math.min(slit, 1 - slit);
      return (1 - tip) * (1 - band * (1 - smooth(edge, 0.03, 0.16)) * 0.5);
    });

    geometry = attachDetails(
      geometry,
      eyePair(0.1, span * 0.12, -0.04, length * 0.42),
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
  viewDistance: 13,
  build() {
    const shellLength = 5.2;

    const shell = buildBody({
      length: shellLength,
      segments: 34,
      radial: 30,
      radius(t) {
        // Skewed forward so the carapace is a teardrop — broadest ahead of
        // centre, tapering to the rear — rather than a symmetric oval.
        const w = Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, 1.3))), 0.5);
        return { x: 0.05 + w * 2.25, y: 0.04 + Math.pow(w, 0.8) * 0.92 };
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
        length: 2.1,
        segments: 18,
        radial: 14,
        radius(t) {
          // Slim neck, swelling to the skull, tapering to a hooked beak.
          const neck = 0.26 + 0.22 * smooth(t, 0.05, 0.5);
          const skull = 1 - 0.62 * smooth(t, 0.62, 1);
          return { x: neck * skull * 1.05, y: neck * skull };
        },
        offsetY: (t) => -0.06 * smooth(t, 0.5, 1),
        sharpness: () => 2.3,
      }),
      (m) => m.makeTranslation(0, -0.12, 2.95),
    );

    let geometry = applyCountershading(
      mergeGeometries([shell, head]),
      0x74924e,
      0xdcd9a4,
      0.42,
    );

    // Scutes. The plates are laid out in a rough grid of latitude and longitude
    // over the carapace, so darkening the seams of that grid reproduces the
    // pattern without needing a texture or any extra geometry.
    geometry = overlayPattern(geometry, (x, y, z) => {
      // Carapace only: the head and the flat plastron carry different plates.
      if (y < -0.28 || z > 2.3) return 1;
      const radius = Math.hypot(x, z);
      if (radius < 0.25) return 1;

      const longitude = ((Math.atan2(x, z) / Math.PI + 1) * 0.5) * 9;
      const latitude = (Math.atan2(y + 0.3, radius) / (Math.PI * 0.5)) * 3.4;

      const du = Math.abs(longitude - Math.round(longitude));
      const dv = Math.abs(latitude - Math.round(latitude));
      const seam = Math.min(du, dv);

      return 0.5 + 0.5 * smooth(seam, 0.015, 0.12);
    });

    geometry = attachDetails(geometry, eyePair(0.08, 0.23, 0.02, 3.62));

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
      flatShading: false,
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
          stations: 10,
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
    addFlipper(1, 1.4, 2.7, 1.2, 0, 0.48);
    addFlipper(-1, 1.4, 2.7, 1.2, Math.PI, 0.48);
    addFlipper(1, -1.55, 1.4, 0.85, Math.PI * 0.6, 0.2);
    addFlipper(-1, -1.55, 1.4, 0.85, Math.PI * 1.6, 0.2);

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
