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

import { CAMERA, WORLD } from "../src/core/config";
import { CameraRig } from "../src/control/cameraRig";
import type { Input } from "../src/control/input";
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

// -- the camera stays in the water -------------------------------------------
//
// Orbiting down swings the camera below the animal, far enough at any usual
// distance to pass through the seabed — and with back faces culled, what you
// see from under the floor is not rock but straight through it. Checked over
// real terrain across the full range of pitch and zoom, because whether the
// camera clears the ground depends on all of the pitch, the distance, and
// whatever the seabed happens to be doing underneath.

console.log("\nCamera — never under the seabed, never out of the water\n");

/** Just enough of an Input for the rig; it reads no more than this. */
function fakeInput(dragX: number, dragY: number): Input {
  return {
    dragX,
    dragY,
    wheel: 0,
    steering: false,
    steerX: 0,
    steerY: 0,
    keySteering: false,
    ndcX: 0,
    ndcY: 0,
    // Past the idle delay the rig starts drifting on its own, which would make
    // this measure the drift rather than the dragging.
    idleTime: 0,
    consume() {},
    tick() {},
    dispose() {},
  };
}

const cameraTerrain = new Terrain(0x5eed);
let worstIntoFloor = 0;
let worstIntoAir = 0;
let samples = 0;

for (const startDepth of [6, 14, 30]) {
  for (const distance of [CAMERA.minDistance, CAMERA.distance, CAMERA.maxDistance]) {
    const swimmer = new Swimmer(cameraTerrain);
    const rig = new CameraRig(16 / 9, cameraTerrain);
    rig.ensureRoomFor(distance);

    // Sit the animal a set height above whatever the floor is doing here.
    swimmer.position.set(120, cameraTerrain.heightAt(120, -80) + startDepth, -80);
    swimmer.object.position.copy(swimmer.position);

    // Drag all the way down, then all the way back up, a frame at a time.
    for (let i = 0; i < 900; i++) {
      const dragY = i < 450 ? -14 : 14;
      rig.update(DT, fakeInput(0, dragY), swimmer);

      const { x, y, z } = rig.camera.position;
      const floor = cameraTerrain.heightAt(x, z) + CAMERA.floorClearance;
      const ceiling = WORLD.surfaceY - CAMERA.airClearance;

      worstIntoFloor = Math.max(worstIntoFloor, floor - y);
      // Only counts as breaking out when there was room to stay under.
      if (ceiling > floor) worstIntoAir = Math.max(worstIntoAir, y - ceiling);
      samples++;
    }
  }
}

console.log(`samples                 ${samples}`);
console.log(`deepest into the floor  ${worstIntoFloor.toFixed(3)} m`);
console.log(`highest into the air    ${worstIntoAir.toFixed(3)} m`);

// A hair of tolerance for floating point, and nothing more.
if (worstIntoFloor > 0.001) {
  failures++;
  console.log(`  FAIL: camera went ${worstIntoFloor.toFixed(2)} m below its floor clearance`);
}
if (worstIntoAir > 0.001) {
  failures++;
  console.log(`  FAIL: camera rose ${worstIntoAir.toFixed(2)} m out of the water`);
}

console.log("");
if (failures > 0) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("Every control goes the way it looks, and the camera stays in the water.");
