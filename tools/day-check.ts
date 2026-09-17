/**
 * Headless check that the day cycle keeps the look it was given.
 *
 * Three things could go wrong here without anything obviously breaking. The
 * middle of the day could drift away from the look the scene was tuned with,
 * one colour at a time, until "day" is no longer the approved picture. A key
 * could be mistyped into a jump, which on screen is the whole ocean changing
 * colour in one frame. And night could slide toward black, which stops it
 * reading as water at all. Each of those is a number, so each is checked.
 *
 * Run with:  npm run verify:day
 */

import * as THREE from "three";
import { DAY, WATER } from "../src/core/config";
import {
  DayClock,
  createDayLight,
  formatPhase,
  phaseFromHash,
  sampleDay,
  sunOffset,
} from "../src/world/dayCycle";
import type { DayLight } from "../src/world/dayCycle";

const failures: string[] = [];
let passed = 0;
function check(condition: boolean, name: string): void {
  if (condition) passed++;
  else failures.push(name);
}

const close = (a: number, b: number, epsilon = 1e-6) => Math.abs(a - b) <= epsilon;
const sameColor = (color: THREE.Color, hex: number) => {
  const target = new THREE.Color(hex);
  return close(color.r, target.r) && close(color.g, target.g) && close(color.b, target.b);
};
const luminance = (color: THREE.Color) => 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

// -- the keys themselves -------------------------------------------------------

const keys = DAY.keys;
check(keys.every((key) => key.phase >= 0 && key.phase < 1), "every key sits inside the day");
check(
  keys.every((key, i) => i === 0 || key.phase > keys[i - 1]!.phase),
  "keys are in order with no two at the same moment",
);

// -- the middle of the day is the approved look ---------------------------------

// These are the values the scene was tuned with before there was a clock. The
// shaft and caustic numbers lived in their own files then.
for (const phase of [0.36, 0.45, 0.5, 0.58, 0.64]) {
  const light = sampleDay(phase);
  const at = formatPhase(phase);
  check(sameColor(light.shallow, WATER.shallowColor), `${at} keeps the approved shallow water`);
  check(sameColor(light.deep, WATER.deepColor), `${at} keeps the approved deep water`);
  check(sameColor(light.surfaceGlow, WATER.surfaceGlow), `${at} keeps the approved surface glow`);
  check(sameColor(light.sunColor, WATER.sunColor), `${at} keeps the approved sun colour`);
  check(close(light.sun, WATER.sunIntensity), `${at} keeps the approved sun`);
  check(close(light.ambient, WATER.ambientIntensity), `${at} keeps the approved ambient`);
  check(close(light.fill, WATER.fillIntensity), `${at} keeps the approved fill`);
  check(sameColor(light.shaftColor, 0xdcf7ff) && close(light.shafts, 0.26), `${at} keeps the approved light shafts`);
  check(sameColor(light.causticColor, 0xd6f6ff) && close(light.caustics, 0.95), `${at} keeps the approved caustics`);
  check(close(light.warmth, 1) && close(light.glow, 0), `${at} keeps the approved grade, and nothing glows`);
}

const [baseX] = DAY.sunOffset;
check(close(sunOffset(0.5).x, baseX), "at noon the sun is where it always was");
check(sunOffset(0.25).x > baseX && sunOffset(0.75).x < baseX, "the sun rises on one side and sets on the other");

// -- no jumps, anywhere, including across midnight ------------------------------

const STEPS = 20000;
const channels = (light: DayLight) => [
  light.shallow.r, light.shallow.g, light.shallow.b,
  light.deep.r, light.deep.g, light.deep.b,
  light.surfaceGlow.r, light.surfaceGlow.g, light.surfaceGlow.b,
  light.sunColor.r, light.sunColor.g, light.sunColor.b,
  light.shaftColor.r, light.shaftColor.g, light.shaftColor.b,
  light.causticColor.r, light.causticColor.g, light.causticColor.b,
  light.sun, light.ambient, light.fill, light.shafts, light.caustics,
  light.warmth / 2, light.glow,
];

let previous = channels(sampleDay(0));
let worstStep = 0;
let worstAt = 0;
for (let i = 1; i <= STEPS; i++) {
  // The last step lands back on phase 0, so the wrap is checked like any other.
  const phase = i / STEPS;
  const next = channels(sampleDay(phase));
  for (let c = 0; c < next.length; c++) {
    const step = Math.abs(next[c]! - previous[c]!);
    if (step > worstStep) {
      worstStep = step;
      worstAt = phase;
    }
  }
  previous = next;
}
// A 1200-second day at 60fps is 72,000 frames; at 20,000 samples each step here
// spans more than three frames, so the per-frame change is smaller still.
check(worstStep < 0.004, `no jump anywhere in the day (worst ${worstStep.toFixed(5)} at ${formatPhase(worstAt)})`);

// -- night is dark, and still water ---------------------------------------------

const noon = sampleDay(0.5, createDayLight());
const midnight = sampleDay(0, createDayLight());
check(luminance(midnight.shallow) < luminance(noon.shallow) * 0.25, "midnight is much darker than noon");
check(midnight.shallow.b > midnight.shallow.r * 2, "night water is still blue, not grey");
check(luminance(midnight.deep) > 0.004, "night never reaches black");
check(midnight.glow === 1 && noon.glow === 0, "the specks glow at night and not at noon");
check(midnight.shafts < noon.shafts * 0.3, "sunlight shafts all but vanish at night");

// Sunrise and sunset should actually be warm, or they are just a dimmer day.
for (const [name, phase] of [["sunrise", 0.27], ["sunset", 0.73]] as const) {
  const light = sampleDay(phase, createDayLight());
  check(light.surfaceGlow.r > light.surfaceGlow.b, `the ${name} window overhead is warm`);
}

// -- the clock and the link ------------------------------------------------------

{
  const clock = new DayClock(0.3);
  for (let i = 0; i < DAY.length * 10; i++) clock.update(0.1);
  check(close(clock.phase, 0.3, 1e-6), "a whole day of frames comes back round to the same moment");
}

check(formatPhase(0.5) === "12:00" && formatPhase(0.75) === "18:00", "the clock reads as hours");
check(phaseFromHash("#seed=abc&time=dusk") === 0.79, "a named time in a link");
check(phaseFromHash("#time=18") === 0.75, "an hour in a link");
check(phaseFromHash("#time=24") === 0, "hour 24 is midnight");
check(phaseFromHash("#time=25") === null && phaseFromHash("#time=teatime") === null, "an unusable time is ignored");
check(phaseFromHash("#seed=abc") === null, "no time in a link is no time");

if (failures.length > 0) {
  console.error(`Day check failed (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`${passed} day checks passed. Noon is still the approved look, and nothing jumps.`);
