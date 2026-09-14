import * as THREE from "three";

/**
 * Low-poly body construction.
 *
 * Everything is generated here at load time: no model files, no loader, no
 * licence to track, and a page that starts instantly. The faceted look that
 * falls out of low segment counts plus flat shading is the art direction, not
 * a compromise — it stays readable through fog at distance, which detailed
 * meshes would not.
 *
 * Convention: every creature faces **+Z**, with +Y up. The tail is at -Z.
 */

export interface BodyProfile {
  /** Total nose-to-tail length. */
  length: number;
  /** Rings along the body. More is smoother and costs almost nothing here. */
  segments: number;
  /** Points around each ring. 8 reads as faceted without looking crude. */
  radial: number;
  /**
   * Half-width and half-height at `t`, where t=0 is the tail and t=1 the nose.
   * Returning zero at both ends closes the body into a point.
   */
  radius(t: number): { x: number; y: number };
  /**
   * Vertical offset of the section centre at `t`.
   *
   * An animal is not symmetric about its own axis: a whale's jaw hangs below
   * its centreline while its back arches above it. Offsetting the sections is
   * what turns a tube of revolution into something with a belly and a spine.
   */
  offsetY?(t: number): number;
  /**
   * Superellipse exponent at `t`. 2 is a plain ellipse; higher is squarer and
   * more slab-sided; lower tends toward a teardrop.
   *
   * Real bodies are not elliptical in section — a cetacean is close to 2.4
   * amidships and rounds off toward the extremities.
   */
  sharpness?(t: number): number;
}

/**
 * A point on a superellipse: |x/a|^n + |y/b|^n = 1.
 *
 * Written with signed powers so it stays continuous through all four
 * quadrants, which the naive `pow` form does not.
 */
function superellipse(
  theta: number,
  a: number,
  b: number,
  n: number,
  out: { x: number; y: number },
): void {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const e = 2 / n;
  out.x = a * Math.sign(c) * Math.pow(Math.abs(c), e);
  out.y = b * Math.sign(s) * Math.pow(Math.abs(s), e);
}

/**
 * A closed tube whose cross-section is an ellipse that varies along its length.
 *
 * This one function produces every animal body in the game; the difference
 * between a whale and a dolphin is entirely in the profile callback.
 */
export function buildBody(profile: BodyProfile): THREE.BufferGeometry {
  const { length, segments, radial } = profile;

  const positions: number[] = [];
  const indices: number[] = [];
  const point = { x: 0, y: 0 };

  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const z = -length / 2 + t * length;
    const r = profile.radius(t);
    const offset = profile.offsetY ? profile.offsetY(t) : 0;
    const n = profile.sharpness ? profile.sharpness(t) : 2;

    for (let i = 0; i < radial; i++) {
      const theta = (i / radial) * Math.PI * 2;
      superellipse(theta, r.x, r.y, n, point);
      positions.push(point.x, point.y + offset, z);
    }
  }

  for (let s = 0; s < segments; s++) {
    for (let i = 0; i < radial; i++) {
      const next = (i + 1) % radial;
      const a = s * radial + i;
      const b = s * radial + next;
      const c = (s + 1) * radial + i;
      const d = (s + 1) * radial + next;

      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * NACA four-digit symmetric half-thickness, normalised to peak at 1.
 *
 * Rounded at the leading edge, thickest around 30% chord, tapering to a fine
 * trailing edge. This one curve is the difference between a fin that looks
 * like a blade and one that looks like a piece of card.
 */
function foilThickness(c: number): number {
  const x = Math.min(1, Math.max(0, c));
  const yt =
    0.2969 * Math.sqrt(x) -
    0.126 * x -
    0.3516 * x * x +
    0.2843 * x * x * x -
    0.1015 * x * x * x * x;
  return Math.max(0, yt) / 0.1002;
}

/**
 * Build one closed airfoil ring, walking the upper surface forward to back and
 * the lower surface back to front.
 *
 * A floor is applied to the half-thickness so the leading and trailing edges
 * do not collapse to exactly coincident points — degenerate triangles there
 * produce NaN vertex normals, which blacken the whole fin.
 */
function foilRing(
  out: number[],
  chord: number,
  thickness: number,
  chordSegments: number,
  spanValue: number,
  centreOffset: number,
  zOffset: number,
  spanAxis: "x" | "y",
): void {
  const count = chordSegments * 2;
  const floor = Math.max(thickness * 0.02, 1e-3);

  for (let i = 0; i < count; i++) {
    const u = i / count;
    const upper = u <= 0.5;
    const c = upper ? u * 2 : (1 - u) * 2;

    const half = Math.max(foilThickness(c) * thickness * 0.5, floor);
    const th = (upper ? half : -half) + centreOffset;
    const z = zOffset + chord * (0.5 - c);

    if (spanAxis === "x") out.push(spanValue, th, z);
    else out.push(th, spanValue, z);
  }
}

/** Join two consecutive rings of `count` points into a band of quads. */
function stitchRings(indices: number[], ringA: number, ringB: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    indices.push(ringA + i, ringB + i, ringA + next);
    indices.push(ringA + next, ringB + i, ringB + next);
  }
}

/** Close a ring with a fan to a central point. */
function capRing(
  positions: number[],
  indices: number[],
  ringStart: number,
  count: number,
  flip: boolean,
): void {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < count; i++) {
    cx += positions[(ringStart + i) * 3]!;
    cy += positions[(ringStart + i) * 3 + 1]!;
    cz += positions[(ringStart + i) * 3 + 2]!;
  }

  const centre = positions.length / 3;
  positions.push(cx / count, cy / count, cz / count);

  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    if (flip) indices.push(centre, ringStart + next, ringStart + i);
    else indices.push(centre, ringStart + i, ringStart + next);
  }
}

/**
 * A fin, flipper or dorsal with a real aerofoil section and a curved planform.
 *
 * Emitted already pointing the right way rather than built flat and rotated
 * into place. Composing Euler angles for eight separate appendages is a
 * reliable source of subtly inside-out geometry; naming the span axis costs one
 * parameter and removes the whole class of mistake.
 *
 * The chord always runs along Z (the creature's own front-to-back), `spanAxis`
 * says which way the fin extends, and thickness takes the remaining axis.
 * `sweep` rakes the tip backwards and `rise` bends it out of plane, which
 * together are what give a pectoral fin its characteristic curve.
 */
export function buildFoil(options: {
  span: number;
  /** Chord length at span fraction s, where s runs 0 (root) to 1 (tip). */
  chord: (s: number) => number;
  /** How far back the section sits at s. */
  sweep: (s: number) => number;
  /** Maximum section thickness at s. */
  thickness: (s: number) => number;
  /** Out-of-plane bend at s — dihedral, or the droop of a long pectoral. */
  rise?: (s: number) => number;
  spanAxis: "x" | "y";
  /** +1 or -1: which side the fin extends toward. */
  sign?: number;
  stations?: number;
  chordSegments?: number;
}): THREE.BufferGeometry {
  const {
    span,
    chord,
    sweep,
    thickness,
    rise,
    spanAxis,
    sign = 1,
    stations = 9,
    chordSegments = 9,
  } = options;

  const positions: number[] = [];
  const indices: number[] = [];
  const ringCount = chordSegments * 2;

  for (let i = 0; i <= stations; i++) {
    const s = i / stations;
    foilRing(
      positions,
      chord(s),
      thickness(s),
      chordSegments,
      span * sign * s,
      rise ? rise(s) : 0,
      sweep(s),
      spanAxis,
    );
  }

  for (let i = 0; i < stations; i++) {
    stitchRings(indices, i * ringCount, (i + 1) * ringCount, ringCount);
  }

  capRing(positions, indices, 0, ringCount, sign > 0);
  capRing(positions, indices, stations * ringCount, ringCount, sign < 0);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A cetacean tail fluke: one piece spanning both sides, swept back to the tips,
 * with a notch cut into the centre of the trailing edge.
 *
 * The notch is the detail that reads as "whale" at a glance. Two separate
 * straight blades — which is what this replaces — read as "aircraft".
 */
export function buildFluke(options: {
  halfSpan: number;
  chordCentre: number;
  /** How far the tips trail behind the centre. */
  sweep: number;
  thickness: number;
  /** Depth of the central notch, as a fraction of the centre chord. */
  notchDepth?: number;
  /** Width of the notch, as a fraction of the half-span. */
  notchWidth?: number;
  spanStations?: number;
  chordSegments?: number;
}): THREE.BufferGeometry {
  const {
    halfSpan,
    chordCentre,
    sweep,
    thickness,
    notchDepth = 0.42,
    notchWidth = 0.17,
    spanStations = 9,
    chordSegments = 9,
  } = options;

  const positions: number[] = [];
  const indices: number[] = [];
  const ringCount = chordSegments * 2;
  const rings = spanStations * 2;

  for (let i = 0; i <= rings; i++) {
    // s sweeps the full span, tip to tip.
    const s = (i / rings) * 2 - 1;
    const a = Math.abs(s);

    const taper = 1 - 0.74 * Math.pow(a, 1.5);
    const notch = 1 - notchDepth * Math.exp(-((s / notchWidth) ** 2));
    const chord = Math.max(chordCentre * taper * notch, chordCentre * 0.04);

    // Sweeping the *centre* back rather than the leading edge keeps the
    // leading edge smoothly curved through the notch instead of kinking.
    const zOffset = -sweep * Math.pow(a, 1.3) - (chordCentre - chord) * 0.5;

    foilRing(
      positions,
      chord,
      thickness * (1 - 0.55 * a),
      chordSegments,
      halfSpan * s,
      0,
      zOffset,
      "x",
    );
  }

  for (let i = 0; i < rings; i++) {
    stitchRings(indices, i * ringCount, (i + 1) * ringCount, ringCount);
  }

  capRing(positions, indices, 0, ringCount, false);
  capRing(positions, indices, rings * ringCount, ringCount, true);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A flattened diamond wing-disc, for rays.
 *
 * Generated as a grid rather than a fan so the vertex shader has enough
 * spanwise resolution to ripple the wings convincingly.
 */
export function buildWingDisc(options: {
  span: number;
  length: number;
  thickness: number;
  cols: number;
  rows: number;
}): THREE.BufferGeometry {
  const { span, length, thickness, cols, rows } = options;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const z = (v - 0.5) * length;
    // Diamond silhouette: widest just forward of centre, swept back at the tips.
    const widthAt = Math.sin(Math.PI * Math.pow(v, 0.85)) * span * 0.5;

    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const x = (u - 0.5) * 2 * widthAt;
      const taper = 1 - Math.abs(u - 0.5) * 2;
      const y = Math.pow(Math.max(taper, 0), 1.6) * thickness;
      positions.push(x, y, z);
    }
  }

  const stride = cols + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * stride + c;
      const b = a + 1;
      const d = a + stride;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }

  const top = new THREE.BufferGeometry();
  top.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  top.setIndex(indices);
  top.computeVertexNormals();

  // Mirror for the underside so the ray is solid from every angle.
  const bottom = top.clone();
  const bottomPos = bottom.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < bottomPos.count; i++) {
    bottomPos.setY(i, -bottomPos.getY(i) * 0.45);
  }
  const bottomIndex = bottom.getIndex()!;
  const flipped = Array.from(bottomIndex.array);
  for (let i = 0; i < flipped.length; i += 3) {
    const tmp = flipped[i]!;
    flipped[i] = flipped[i + 2]!;
    flipped[i + 2] = tmp;
  }
  bottom.setIndex(flipped);
  bottom.computeVertexNormals();

  return mergeGeometries([top, bottom]);
}

/** Minimal position-and-index geometry merge. Enough for our own builders. */
export function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
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
      for (let i = 0; i < index.count; i++) {
        indices.push(index.getX(i) + offset);
      }
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

/**
 * Countershading: dark on top, pale underneath.
 *
 * Real marine animals are coloured this way, and it happens to solve a
 * rendering problem too — a single flat colour turns to silhouette the moment
 * the animal is seen side-on against open water. A vertical gradient keeps the
 * body readable from every angle for the cost of one attribute.
 */
export function applyCountershading(
  geometry: THREE.BufferGeometry,
  back: number,
  belly: number,
  /** Pushes the transition up or down the body. */
  bias = 0.5,
): THREE.BufferGeometry {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;

  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const minY = box.min.y;
  const span = Math.max(box.max.y - minY, 1e-5);

  const backColor = new THREE.Color(back);
  const bellyColor = new THREE.Color(belly);
  const mixed = new THREE.Color();

  const colors = new Float32Array(position.count * 3);

  for (let i = 0; i < position.count; i++) {
    // Which way the surface faces is the primary signal, not how high it sits.
    // On a flat-bodied animal like a ray, the top of the wing and its
    // underside are at almost the same height — keyed to height alone the
    // whole wing comes out one colour and the countershading vanishes exactly
    // where it matters most. Facing direction separates them cleanly.
    const facing = normal ? normal.getY(i) : 0;
    const byNormal = THREE.MathUtils.smoothstep(facing, -0.4, 0.45);

    // Height still contributes a little, so rounded bodies keep a gradient
    // down the flank rather than a hard band where the normal flips.
    const height = (position.getY(i) - minY) / span;
    const byHeight = THREE.MathUtils.smoothstep(height, bias - 0.38, bias + 0.38);

    const k = byNormal * 0.72 + byHeight * 0.28;
    mixed.copy(bellyColor).lerp(backColor, k);

    colors[i * 3] = mixed.r;
    colors[i * 3 + 1] = mixed.g;
    colors[i * 3 + 2] = mixed.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Multiply the existing vertex colours by a per-position factor.
 *
 * Runs after countershading, so markings ride on top of the base shading
 * rather than replacing it. This is how the turtle gets its scute seams, the
 * whale its ventral pleats and the ray its gill slits — all surface detail
 * that would otherwise need either geometry or a texture, and needs neither.
 */
export function overlayPattern(
  geometry: THREE.BufferGeometry,
  shade: (x: number, y: number, z: number) => number,
): THREE.BufferGeometry {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const color = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (!color) return geometry;

  for (let i = 0; i < position.count; i++) {
    const k = shade(position.getX(i), position.getY(i), position.getZ(i));
    if (k === 1) continue;
    color.setXYZ(i, color.getX(i) * k, color.getY(i) * k, color.getZ(i) * k);
  }

  color.needsUpdate = true;
  return geometry;
}

/**
 * Append solid-coloured detail geometry to an already-coloured body.
 *
 * Eyes must not be countershaded — a pale eye on a pale belly is invisible and
 * a dark one on a dark back is too — so they are merged in after shading with
 * their own fixed colour. The base geometry's own colours are carried across
 * untouched.
 */
export function attachDetails(
  base: THREE.BufferGeometry,
  details: Array<{ geometry: THREE.BufferGeometry; color: number }>,
): THREE.BufferGeometry {
  if (details.length === 0) return base;

  const basePos = base.getAttribute("position") as THREE.BufferAttribute;
  const baseColor = base.getAttribute("color") as THREE.BufferAttribute | undefined;
  const baseIndex = base.getIndex();

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < basePos.count; i++) {
    positions.push(basePos.getX(i), basePos.getY(i), basePos.getZ(i));
    if (baseColor) colors.push(baseColor.getX(i), baseColor.getY(i), baseColor.getZ(i));
    else colors.push(1, 1, 1);
  }

  if (baseIndex) {
    for (let i = 0; i < baseIndex.count; i++) indices.push(baseIndex.getX(i));
  } else {
    for (let i = 0; i < basePos.count; i++) indices.push(i);
  }

  const tint = new THREE.Color();

  for (const detail of details) {
    const offset = positions.length / 3;
    const pos = detail.geometry.getAttribute("position") as THREE.BufferAttribute;
    tint.setHex(detail.color);

    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      colors.push(tint.r, tint.g, tint.b);
    }

    const index = detail.geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + offset);
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(i + offset);
    }

    detail.geometry.dispose();
  }

  base.dispose();

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  merged.setIndex(indices);
  merged.computeVertexNormals();
  return merged;
}

/** Apply a transform to a geometry's vertices and bake it in. */
export function transformed(
  geometry: THREE.BufferGeometry,
  transform: (m: THREE.Matrix4) => void,
): THREE.BufferGeometry {
  const matrix = new THREE.Matrix4();
  transform(matrix);
  geometry.applyMatrix4(matrix);
  geometry.computeVertexNormals();
  return geometry;
}
