/**
 * Headless verification of the ambient wander.
 *
 * The screensaver requirement — swims forever, never grounds itself, never
 * settles into a loop — is the one thing that cannot be checked by looking at
 * a screenshot. It only shows up over tens of minutes, which is impractical to
 * watch and impossible to eyeball reliably.
 *
 * So this simulates the autopilot directly: no renderer, no browser, no
 * animation frames. It steps the same Wander and Swimmer the game uses, over
 * the same procedural terrain, at a fixed timestep, and then measures what the
 * path actually did.
 *
 * Run with:  npm run verify:wander
 */

import { WORLD } from "../src/core/config";
import { Swimmer } from "../src/creatures/swimmer";
import { Wander } from "../src/creatures/wander";
import { Terrain } from "../src/world/terrain";

interface Result {
  seed: number;
  species: string;
  minutes: number;
  distanceTravelled: number;
  cellsVisited: number;
  spanX: number;
  spanZ: number;
  netDisplacement: number;
  minClearance: number;
  clampedFrames: number;
  surfaceBreaches: number;
  maxRevisitDwell: number;
  stalledFrames: number;
  /**
   * Signed turning divided by total turning, in [-1, 1].
   *
   * Zero means left and right balance out; ±1 means every degree of turning
   * went the same way. This is the number that catches "it just kept curving
   * right" — a path can cover plenty of fresh ground while doing it, so
   * coverage and displacement both pass and say nothing about it.
   */
  turnBias: number;
  /** Longest unbroken stretch spent turning one way, in seconds. */
  longestOneWay: number;
  /** Share of the twelve compass sectors the heading ever pointed into. */
  headingCoverage: number;
}

const DT = 1 / 60;

/** Grid used to measure exploration: how much distinct ground was covered. */
const CELL = 64;

function simulate(seed: number, minutes: number, turnScale: number, label: string): Result {
  const terrain = new Terrain(seed);
  const swimmer = new Swimmer(terrain);
  const wander = new Wander(terrain, seed);

  swimmer.position.set(0, terrain.heightAt(0, 0) + 18, 0);

  const steps = Math.round((minutes * 60) / DT);
  const visited = new Set<string>();

  let elapsed = 0;
  let distance = 0;
  let minClearance = Infinity;
  let clampedFrames = 0;
  let surfaceBreaches = 0;
  let stalledFrames = 0;

  let prevX = swimmer.position.x;
  let prevY = swimmer.position.y;
  let prevZ = swimmer.position.z;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  // Revisit dwell: the longest stretch spent inside a single cell. A creature
  // orbiting one patch of seabed racks this up; one that explores does not.
  let currentCell = "";
  let cellEntered = 0;
  let maxRevisitDwell = 0;

  let signedTurn = 0;
  let absoluteTurn = 0;
  let oneWaySince = 0;
  let oneWaySign = 0;
  let longestOneWay = 0;
  let prevYaw = swimmer.yaw;
  const sectors = new Set<number>();

  /**
   * Below this rate, in radians per second, the animal is holding course.
   *
   * Set above the drift the course wobble produces on its own — roughly
   * 0.04 rad/s, or a bit over two degrees a second, which is not something a
   * viewer would call turning. Any lower and this measures the wobble's own
   * period instead of the thing it is meant to catch.
   */
  const TURN_DEADBAND = 0.06;

  for (let i = 0; i < steps; i++) {
    elapsed += DT;

    const command = wander.update(DT, elapsed, swimmer);
    command.turnRate *= turnScale;
    swimmer.update(DT, elapsed, command);

    let dYaw = swimmer.yaw - prevYaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    prevYaw = swimmer.yaw;

    signedTurn += dYaw;
    absoluteTurn += Math.abs(dYaw);

    const rate = dYaw / DT;
    const sign = rate > TURN_DEADBAND ? 1 : rate < -TURN_DEADBAND ? -1 : 0;
    if (sign !== oneWaySign) {
      if (oneWaySign !== 0) {
        longestOneWay = Math.max(longestOneWay, elapsed - oneWaySince);
      }
      oneWaySign = sign;
      oneWaySince = elapsed;
    }

    sectors.add(Math.floor(((swimmer.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 6)));

    const { x, y, z } = swimmer.position;

    const stepDistance = Math.hypot(x - prevX, y - prevY, z - prevZ);
    distance += stepDistance;
    if (stepDistance < 1e-4) stalledFrames++;

    prevX = x;
    prevY = y;
    prevZ = z;

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;

    const clearance = y - terrain.heightAt(x, z);
    if (clearance < minClearance) minClearance = clearance;
    if (swimmer.clamped) clampedFrames++;
    if (y > WORLD.surfaceY) surfaceBreaches++;

    const cell = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    visited.add(cell);

    if (cell !== currentCell) {
      maxRevisitDwell = Math.max(maxRevisitDwell, elapsed - cellEntered);
      currentCell = cell;
      cellEntered = elapsed;
    }
  }

  maxRevisitDwell = Math.max(maxRevisitDwell, elapsed - cellEntered);
  if (oneWaySign !== 0) longestOneWay = Math.max(longestOneWay, elapsed - oneWaySince);

  return {
    turnBias: absoluteTurn > 1e-6 ? signedTurn / absoluteTurn : 0,
    longestOneWay,
    headingCoverage: sectors.size / 12,
    seed,
    species: label,
    minutes,
    distanceTravelled: distance,
    cellsVisited: visited.size,
    spanX: maxX - minX,
    spanZ: maxZ - minZ,
    netDisplacement: Math.hypot(swimmer.position.x, swimmer.position.z),
    minClearance,
    clampedFrames,
    surfaceBreaches,
    maxRevisitDwell,
    stalledFrames,
  };
}

const MINUTES = 20;

// Several seeds, because one lucky world proves nothing. Turn scales match the
// real species, so the laziest turner (the whale) and the twitchiest (the
// dolphin) are both covered.
const CASES: Array<{ seed: number; turnScale: number; label: string }> = [
  { seed: 0x1a2b3c4d, turnScale: 0.62, label: "whale" },
  { seed: 0x51ed270b, turnScale: 0.8, label: "turtle" },
  { seed: 0x7f4a7c15, turnScale: 0.95, label: "manta" },
  { seed: 0xc0ffee11, turnScale: 1.35, label: "dolphin" },
  { seed: 0x00000539, turnScale: 1.0, label: "plain" },
];

const results = CASES.map((c) => simulate(c.seed, MINUTES, c.turnScale, c.label));

console.log(`\nAmbient wander — ${MINUTES} simulated minutes per case\n`);
console.log(
  [
    "case".padEnd(9),
    "travelled".padStart(10),
    "cells".padStart(7),
    "spanX".padStart(8),
    "spanZ".padStart(8),
    "net".padStart(8),
    "minClear".padStart(9),
    "dwell".padStart(7),
    "bias".padStart(7),
    "oneWay".padStart(8),
    "compass".padStart(8),
  ].join(" "),
);

let failures = 0;

for (const r of results) {
  console.log(
    [
      r.species.padEnd(9),
      r.distanceTravelled.toFixed(0).padStart(10),
      String(r.cellsVisited).padStart(7),
      r.spanX.toFixed(0).padStart(8),
      r.spanZ.toFixed(0).padStart(8),
      r.netDisplacement.toFixed(0).padStart(8),
      r.minClearance.toFixed(2).padStart(9),
      `${r.maxRevisitDwell.toFixed(0)}s`.padStart(7),
      r.turnBias.toFixed(2).padStart(7),
      `${r.longestOneWay.toFixed(0)}s`.padStart(8),
      `${(r.headingCoverage * 100).toFixed(0)}%`.padStart(8),
    ].join(" "),
  );
}

console.log("");

/** Assertions. These are the actual screensaver contract, made checkable. */
function check(name: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — ${detail}`}`);
}

for (const r of results) {
  const prefix = `[${r.species}]`;

  check(
    `${prefix} never stalls`,
    r.stalledFrames === 0,
    `${r.stalledFrames} frames with no movement`,
  );

  // Turning that never balances is what makes a long watch feel like one slow
  // curve in a single direction. Coverage and displacement are both blind to
  // it: a wide right-hand arc crosses plenty of fresh ground.
  check(
    `${prefix} turns both ways`,
    Math.abs(r.turnBias) < 0.25,
    `${(r.turnBias * 100).toFixed(0)}% of all turning went ${r.turnBias > 0 ? "right" : "left"}`,
  );

  check(
    `${prefix} does not curve one way for minutes`,
    r.longestOneWay < 30,
    `turned the same way for ${r.longestOneWay.toFixed(0)}s without a break`,
  );

  // A floor, not a demand for even coverage. Heading spread trades directly
  // against getting anywhere: an animal that commits to a direction for a while
  // travels much further than one that samples the whole compass, and going
  // somewhere is the point. This catches a heading that is genuinely stuck.
  check(
    `${prefix} is not locked to one heading`,
    r.headingCoverage >= 0.5,
    `only reached ${(r.headingCoverage * 12).toFixed(0)} of 12 compass sectors`,
  );

  check(
    `${prefix} never grounds itself`,
    r.clampedFrames === 0,
    `seabed/surface clamp fired on ${r.clampedFrames} frames (min clearance ${r.minClearance.toFixed(2)})`,
  );

  check(
    `${prefix} stays under the surface`,
    r.surfaceBreaches === 0,
    `${r.surfaceBreaches} frames above the waterline`,
  );

  // Twenty minutes at roughly 7 units/second is about 8.5km of swimming. If
  // that only covered a handful of cells, it was swimming in circles.
  check(
    `${prefix} explores rather than circling`,
    r.cellsVisited >= 60,
    `only ${r.cellsVisited} distinct ${CELL}m cells in ${r.minutes} minutes`,
  );

  // Lingering in one 64m cell for minutes on end is the circling failure mode.
  check(
    `${prefix} does not loiter`,
    r.maxRevisitDwell < 75,
    `spent ${r.maxRevisitDwell.toFixed(0)}s inside a single ${CELL}m cell`,
  );

  // It should end up somewhere genuinely else, not back where it started.
  check(
    `${prefix} actually goes somewhere`,
    r.netDisplacement > 400,
    `ended only ${r.netDisplacement.toFixed(0)}m from the start`,
  );
}

console.log("");

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}

console.log("All ambient wander checks passed.");
