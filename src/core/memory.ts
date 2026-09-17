/**
 * What the page remembers between visits.
 *
 * Two records, kept apart because they mean different things. **Settings** are
 * yours and carry across every ocean: whether sound is on, and how loud.
 * **The swim** belongs to one ocean: where the animal was, which way it was
 * heading, and how the camera was framed. Reopening the page in that same
 * ocean picks the swim up exactly where it was left, instead of dropping a new
 * animal at the origin.
 *
 * Storage can be missing (a private window), full, blocked, or holding
 * something damaged or from an older version. Every one of those is treated as
 * a first visit. Nothing read from storage is trusted until every field has
 * been checked, because a single `NaN` position would put the animal nowhere
 * and the camera with it.
 */

const SETTINGS_KEY = "currents-settings";
const SWIM_KEY = "currents-swim";

/** The subset of `Storage` this needs, so the checks can pass a stand-in. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Settings {
  muted: boolean;
  /** 0 to 1. */
  volume: number;
}

export interface SwimRecord {
  seed: number;
  species: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  camera: {
    orbitYaw: number;
    orbitPitch: number;
    distance: number;
  };
  /**
   * Time of day as a phase, 0 to 1. Null for a swim saved before there was a
   * day cycle: that swim still resumes, it just starts the clock fresh.
   */
  time: number | null;
}

export const DEFAULT_SETTINGS: Settings = { muted: false, volume: 0.5 };

/** The browser's storage, or nothing if touching it throws. */
export function browserStore(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readSettings(store: KeyValueStore | null = browserStore()): Settings {
  const raw = readJson(store, SETTINGS_KEY);
  if (!isObject(raw)) return { ...DEFAULT_SETTINGS };

  return {
    muted: typeof raw.muted === "boolean" ? raw.muted : DEFAULT_SETTINGS.muted,
    volume: finite(raw.volume, 0, 1) ?? DEFAULT_SETTINGS.volume,
  };
}

export function writeSettings(
  settings: Settings,
  store: KeyValueStore | null = browserStore(),
): void {
  writeJson(store, SETTINGS_KEY, settings);
}

/** The remembered swim, or null if there is none or any part of it is unusable. */
export function readSwim(store: KeyValueStore | null = browserStore()): SwimRecord | null {
  const raw = readJson(store, SWIM_KEY);
  if (!isObject(raw)) return null;
  const camera = raw.camera;
  if (!isObject(camera)) return null;

  const seed = finite(raw.seed, 1, 0xffffffff);
  const species = typeof raw.species === "string" && /^[a-z]+$/.test(raw.species)
    ? raw.species
    : null;
  const x = finite(raw.x);
  const y = finite(raw.y);
  const z = finite(raw.z);
  const yaw = finite(raw.yaw);
  const pitch = finite(raw.pitch, -Math.PI / 2, Math.PI / 2);
  const orbitYaw = finite(camera.orbitYaw);
  const orbitPitch = finite(camera.orbitPitch);
  const distance = finite(camera.distance, 0);

  if (
    seed === null ||
    !Number.isInteger(seed) ||
    species === null ||
    x === null ||
    y === null ||
    z === null ||
    yaw === null ||
    pitch === null ||
    orbitYaw === null ||
    orbitPitch === null ||
    distance === null
  ) {
    return null;
  }

  // Optional, and on its own terms: a bad time drops only the time. Losing an
  // hour of the day is no reason to lose where the animal was.
  const time = finite(raw.time, 0, 1);

  return {
    seed,
    species,
    x,
    y,
    z,
    yaw,
    pitch,
    camera: { orbitYaw, orbitPitch, distance },
    time: time === 1 ? 0 : time,
  };
}

export function writeSwim(record: SwimRecord, store: KeyValueStore | null = browserStore()): void {
  writeJson(store, SWIM_KEY, record);
}

/** Drop the swim, so the next visit starts a new ocean rather than resuming. */
export function forgetSwim(store: KeyValueStore | null = browserStore()): void {
  try {
    store?.removeItem(SWIM_KEY);
  } catch {
    // Nothing to forget with; the next visit resumes, which is harmless.
  }
}

// -- internals ---------------------------------------------------------------

function readJson(store: KeyValueStore | null, key: string): unknown {
  if (!store) return null;
  try {
    const text = store.getItem(key);
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function writeJson(store: KeyValueStore | null, key: string, value: unknown): void {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked. The page carries on; it just will not remember this.
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown, min = -Infinity, max = Infinity): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}
