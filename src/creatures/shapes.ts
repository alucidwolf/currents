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

  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const z = -length / 2 + t * length;
    const r = profile.radius(t);

    for (let i = 0; i < radial; i++) {
      const theta = (i / radial) * Math.PI * 2;
      positions.push(Math.cos(theta) * r.x, Math.sin(theta) * r.y, z);
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
 * A flat tapered blade: fins, flippers, flukes.
 *
 * Emitted already pointing the right way rather than built flat and rotated
 * into place. Composing Euler angles for eight separate appendages is a
 * reliable source of subtly inside-out geometry; naming the span axis costs one
 * parameter and removes the whole class of mistake.
 *
 * The chord always runs along Z (the creature's own front-to-back), `spanAxis`
 * says which way the blade extends, and thickness takes the remaining axis.
 * `sweep` rakes the tip backwards, which is what stops a fin reading as a
 * rectangle stuck on the side of a tube.
 */
export function buildFin(options: {
  /** Chord where the fin meets the body. */
  chordRoot: number;
  /** Chord at the tip. Smaller tapers the blade. */
  chordTip: number;
  span: number;
  thickness: number;
  sweep: number;
  spanAxis: "x" | "y";
  /** +1 or -1: which side the blade extends toward. */
  sign?: number;
}): THREE.BufferGeometry {
  const { chordRoot, chordTip, span, thickness, sweep, spanAxis } = options;
  const sign = options.sign ?? 1;
  const half = thickness / 2;
  const tipSpan = span * sign;

  const rootFront = chordRoot / 2;
  const rootBack = -chordRoot / 2;
  const tipFront = chordTip / 2 - sweep;
  const tipBack = -chordTip / 2 - sweep;

  // (spanValue, thicknessOffset, z) laid out on the requested axes.
  const vertex = (spanValue: number, thick: number, z: number): [number, number, number] =>
    spanAxis === "x" ? [spanValue, thick, z] : [thick, spanValue, z];

  const positions: number[] = [];
  for (const thick of [half, -half]) {
    positions.push(
      ...vertex(0, thick, rootBack),
      ...vertex(0, thick, rootFront),
      ...vertex(tipSpan, thick, tipFront),
      ...vertex(tipSpan, thick, tipBack),
    );
  }

  const indices = [
    0, 1, 2, 0, 2, 3, // near face
    5, 4, 7, 5, 7, 6, // far face
    1, 5, 6, 1, 6, 2, // leading edge
    4, 0, 3, 4, 3, 7, // trailing edge
    3, 2, 6, 3, 6, 7, // tip
  ];

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
