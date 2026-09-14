/**
 * Deterministic pseudo-randomness.
 *
 * The whole world derives from one seed, so the same seed always rebuilds the
 * same ocean. Chunk contents additionally hash their own coordinates, which
 * means a chunk regenerates identically whether you reach it after ten seconds
 * or ten minutes, from the north or from the south.
 */

export type Rng = () => number;

/** Small, fast, well-distributed 32-bit PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix three integers into one well-scattered 32-bit seed. */
export function hash3(a: number, b: number, c: number): number {
  let h = 2166136261 >>> 0;
  h = Math.imul(h ^ (a | 0), 16777619);
  h = Math.imul(h ^ (b | 0), 16777619);
  h = Math.imul(h ^ (c | 0), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

/** A generator scoped to one chunk of one world. */
export function chunkRng(worldSeed: number, cx: number, cz: number, salt = 0): Rng {
  return mulberry32(hash3(worldSeed ^ salt, cx, cz));
}

export function randRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length]!;
}

/**
 * Resolve this session's world seed.
 *
 * `#seed=12345` in the URL reproduces a previous ocean exactly; otherwise a
 * fresh one is minted from the clock, so no two sessions match.
 */
export function resolveWorldSeed(hash: string = location.hash): number {
  const match = /(?:^|[#&])seed=([0-9a-zA-Z]+)/.exec(hash);
  if (match) {
    const parsed = Number.parseInt(match[1]!, 36);
    if (Number.isFinite(parsed) && parsed !== 0) return parsed >>> 0;
  }
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

/** Render a seed as the short string used in the URL and the HUD. */
export function formatSeed(seed: number): string {
  return seed.toString(36);
}
