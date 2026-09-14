/**
 * Value noise with fBm octaves.
 *
 * Deliberately not simplex: value noise is a handful of lines, has no patent
 * baggage, and at the frequencies used here (broad seabed hills, slow heading
 * drift) the visual difference is nil. It is sampled in *world* space, which is
 * what lets neighbouring terrain chunks agree along their shared edges without
 * any stitching code.
 */

function hash2(x: number, y: number, seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
  h = Math.imul(h ^ (y | 0), 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Smoothstep-style fade, cheaper than the quintic and plenty smooth here. */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 2D value noise in [0, 1]. */
export function valueNoise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);

  const u = fade(xf);
  const v = fade(yf);

  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return top + (bottom - top) * v;
}

/** Layered value noise in [0, 1]. Each octave halves amplitude, doubles detail. */
export function fbm2(
  x: number,
  y: number,
  seed: number,
  octaves: number,
  lacunarity = 2.0,
  gain = 0.5,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2(x * frequency, y * frequency, seed + i * 1013) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return norm > 0 ? sum / norm : 0;
}

/**
 * 1D fBm over time, remapped to [-1, 1].
 *
 * This is the meander driver: sampling it on different seeds gives yaw and
 * pitch signals that wander smoothly and never repeat on a short cycle.
 */
export function fbm1Signed(t: number, seed: number, octaves = 3): number {
  return fbm2(t, 0, seed, octaves) * 2 - 1;
}
