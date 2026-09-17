/**
 * Headless check that the page only ever resumes a swim it can trust.
 *
 * What is in storage is whatever an earlier visit, an older version of the
 * page, a full disk or a curious person left there. A single bad number read
 * back as a position would put the animal nowhere and the camera with it, and
 * nothing on screen would say why. So every way a record can be wrong is fed
 * in here, and each must come back as "no swim" or as defaults, never as a
 * half-trusted record.
 *
 * Run with:  npm run verify:memory
 */

import {
  DEFAULT_SETTINGS,
  forgetSwim,
  readSettings,
  readSwim,
  writeSettings,
  writeSwim,
} from "../src/core/memory";
import type { KeyValueStore, SwimRecord } from "../src/core/memory";
import { resolveWorldSeed, seedFromHash } from "../src/core/rng";

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

/** Storage that throws on every touch, like a blocked or full one. */
const hostile: KeyValueStore = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("full");
  },
  removeItem() {
    throw new Error("blocked");
  },
};

const failures: string[] = [];
let passed = 0;
function check(condition: boolean, name: string): void {
  if (condition) passed++;
  else failures.push(name);
}

const good: SwimRecord = {
  seed: 123456,
  species: "manta",
  x: 412.5,
  y: -20.25,
  z: -88,
  yaw: 1.2,
  pitch: -0.1,
  camera: { orbitYaw: 0.3, orbitPitch: 0.42, distance: 14 },
};

// A good record survives the round trip exactly.
{
  const store = new MemoryStore();
  writeSwim(good, store);
  check(JSON.stringify(readSwim(store)) === JSON.stringify(good), "a written swim reads back unchanged");
  forgetSwim(store);
  check(readSwim(store) === null, "a forgotten swim is gone");
}

// Every field broken in turn must reject the whole record.
const breakages: Array<[string, (r: Record<string, any>) => void]> = [
  ["missing seed", (r) => delete r.seed],
  ["zero seed", (r) => (r.seed = 0)],
  ["fractional seed", (r) => (r.seed = 1.5)],
  ["seed past 32 bits", (r) => (r.seed = 2 ** 33)],
  ["string position", (r) => (r.x = "412")],
  ["null height", (r) => (r.y = null)],
  ["NaN through JSON", (r) => (r.z = Number.NaN)],
  ["pitch past vertical", (r) => (r.pitch = 2)],
  ["species with markup", (r) => (r.species = "<img>")],
  ["missing camera", (r) => delete r.camera],
  ["camera as array", (r) => (r.camera = [1, 2, 3])],
  ["negative distance", (r) => (r.camera.distance = -4)],
  ["infinite orbit", (r) => (r.camera.orbitYaw = "Infinity")],
];

for (const [name, breakIt] of breakages) {
  const store = new MemoryStore();
  const record = JSON.parse(JSON.stringify(good));
  breakIt(record);
  store.setItem("currents-swim", JSON.stringify(record));
  check(readSwim(store) === null, `rejects a swim with ${name}`);
}

// Not JSON at all, or not an object.
for (const raw of ["{not json", "null", "42", '"swim"', "[]"]) {
  const store = new MemoryStore();
  store.setItem("currents-swim", raw);
  check(readSwim(store) === null, `rejects a stored swim of ${raw}`);
}

// Settings fall back field by field rather than all or nothing.
{
  const store = new MemoryStore();
  check(
    JSON.stringify(readSettings(store)) === JSON.stringify(DEFAULT_SETTINGS),
    "no settings means the defaults",
  );
  store.setItem("currents-settings", JSON.stringify({ muted: true, volume: 7 }));
  const read = readSettings(store);
  check(read.muted === true && read.volume === DEFAULT_SETTINGS.volume, "keeps a good field beside a bad one");
  writeSettings({ muted: false, volume: 0.2 }, store);
  check(readSettings(store).volume === 0.2, "a written volume reads back");
}

// Storage that is missing or throws is a first visit, and never an exception.
{
  let threw = false;
  try {
    check(readSwim(hostile) === null, "throwing storage reads as no swim");
    check(readSwim(null) === null, "missing storage reads as no swim");
    check(readSettings(hostile).volume === DEFAULT_SETTINGS.volume, "throwing storage reads as default settings");
    writeSwim(good, hostile);
    writeSettings(DEFAULT_SETTINGS, hostile);
    forgetSwim(hostile);
  } catch {
    threw = true;
  }
  check(!threw, "throwing storage never throws out of memory");
}

// The seed: a link wins, then the remembered ocean, then a fresh one.
check(seedFromHash("#seed=abc&species=manta") === Number.parseInt("abc", 36), "reads a seed from the link");
check(seedFromHash("#species=manta") === null, "no seed in the link is no seed");
check(seedFromHash("#seed=0") === null, "a zero seed is not a seed");
check(resolveWorldSeed("#seed=abc", 999) === Number.parseInt("abc", 36), "a seed in the link beats the remembered one");
check(resolveWorldSeed("", 999) === 999, "with no link, the remembered ocean carries on");
check(resolveWorldSeed("", null) > 0, "with neither, a fresh ocean is minted");

if (failures.length > 0) {
  console.error(`Memory check failed (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`${passed} memory checks passed. The page only resumes a swim it can trust.`);
