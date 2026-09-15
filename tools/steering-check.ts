/**
 * Headless check that the controls go the way they look.
 *
 * Left and right shipped inverted, and the reason is worth recording: the
 * change was "verified" by holding right and watching the yaw number increase,
 * which it did. Nobody asked what a larger yaw does on screen. It turns the
 * animal left — `forward` is `(sin yaw, ·, cos yaw)`, so a larger yaw swings
 * toward +X, while screen right is `cross(forward, up)`, which is −X.
 *
 * So this deliberately never looks at yaw. It presses a key, steps the real
 * Swimmer, and asks which way the animal moved relative to where the screen's
 * right and up were pointing when the key went down. That is the only question
 * whose answer a player can disagree with.
 *
 * Run with:  npm run verify:steering
 */

import { keyboardCommand, screenRight } from "../src/control/steering";
import { Swimmer } from "../src/creatures/swimmer";
import { Terrain } from "../src/world/terrain";

const DT = 1 / 60;
/** Long enough for a turn to show, short enough that nothing else intrudes. */
const SECONDS = 2.5;
const TURN_RATE = 0.95;

interface Outcome {
  /** How far it went along the screen's right, in metres. Negative is left. */
  rightward: number;
  /** How far it climbed. Negative is a dive. */
  upward: number;
}

/** Hold one arrow-key combination from level flight and see where it ends up. */
function hold(steerX: number, steerY: number): Outcome {
  const terrain = new Terrain(0x5eed);
  const swimmer = new Swimmer(terrain);

  // Well clear of the seabed and the surface, so no avoidance clamp can fire
  // and quietly become the thing being measured.
  swimmer.position.set(0, -24, 0);
  swimmer.yaw = 0;
  swimmer.pitch = 0;

  const right = screenRight(swimmer.yaw);
  const start = swimmer.position.clone();

  const steps = Math.round(SECONDS / DT);
  let elapsed = 0;
  for (let i = 0; i < steps; i++) {
    elapsed += DT;
    // Axes arrive already eased in the real thing; held to full here, which is
    // what they settle to within a fraction of a second anyway.
    swimmer.update(DT, elapsed, keyboardCommand(steerX, steerY, swimmer.yaw, TURN_RATE));
  }

  const dx = swimmer.position.x - start.x;
  const dy = swimmer.position.y - start.y;
  const dz = swimmer.position.z - start.z;

  return { rightward: dx * right.x + dz * right.z, upward: dy };
}

interface Case {
  label: string;
  steerX: number;
  steerY: number;
  expect: (o: Outcome) => boolean;
  describe: string;
}

const CASES: Case[] = [
  {
    label: "right arrow",
    steerX: 1,
    steerY: 0,
    expect: (o) => o.rightward > 4,
    describe: "should carry the animal toward the right of the screen",
  },
  {
    label: "left arrow",
    steerX: -1,
    steerY: 0,
    expect: (o) => o.rightward < -4,
    describe: "should carry the animal toward the left of the screen",
  },
  {
    label: "up arrow",
    steerX: 0,
    steerY: 1,
    expect: (o) => o.upward > 2,
    describe: "should carry the animal upward",
  },
  {
    label: "down arrow",
    steerX: 0,
    steerY: -1,
    expect: (o) => o.upward < -2,
    describe: "should carry the animal downward",
  },
  {
    label: "no keys",
    steerX: 0,
    steerY: 0,
    expect: (o) => Math.abs(o.rightward) < 0.5 && Math.abs(o.upward) < 0.5,
    describe: "should hold its course",
  },
];

console.log("\nSteering — where each key actually takes the animal\n");
console.log(["key".padEnd(12), "rightward".padStart(11), "upward".padStart(9)].join(" "));

let failures = 0;

for (const testCase of CASES) {
  const outcome = hold(testCase.steerX, testCase.steerY);
  console.log(
    [
      testCase.label.padEnd(12),
      outcome.rightward.toFixed(2).padStart(11),
      outcome.upward.toFixed(2).padStart(9),
    ].join(" "),
  );

  if (!testCase.expect(outcome)) {
    failures++;
    console.log(`  FAIL: ${testCase.label} ${testCase.describe}`);
  }
}

console.log("");

// Left and right must also be mirror images of one another; a pair that both
// drift the same way would pass the tests above if the drift were large enough.
const left = hold(-1, 0);
const right = hold(1, 0);
const asymmetry = Math.abs(right.rightward + left.rightward);
console.log(`left/right asymmetry  ${asymmetry.toFixed(3)} m`);
if (asymmetry > 0.5) {
  failures++;
  console.log("  FAIL: left and right do not mirror each other");
}

console.log("");
if (failures > 0) {
  console.log(`${failures} steering check(s) failed.`);
  process.exit(1);
}
console.log("Every control goes the way it looks.");
