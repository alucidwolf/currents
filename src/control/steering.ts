import { SWIM } from "../core/config";
import type { SteerCommand } from "../creatures/swimmer";

/**
 * Turning the arrow keys into a heading.
 *
 * Separated from the rest of the wiring because the sign is not something you
 * can settle by reading it. `Swimmer.forward()` is
 * `(sin(yaw)·cos(pitch), sin(pitch), cos(yaw)·cos(pitch))`, so a larger yaw
 * swings the heading toward +X — while screen right, which is
 * `cross(forward, up)`, is −X at yaw zero. Increasing yaw therefore turns the
 * animal *left* from behind, and the obvious mapping of right-arrow to a larger
 * yaw is exactly backwards.
 *
 * It shipped that way. The mistake was checking that pressing right made the
 * number go up, rather than checking which way the animal then went, and the
 * only defence against repeating it is a test that asks the second question —
 * which is why this is a plain function over numbers rather than something
 * tangled up with a renderer. See `npm run verify:steering`.
 */
export function keyboardCommand(
  steerX: number,
  steerY: number,
  currentYaw: number,
  turnRate: number,
): SteerCommand {
  // Both axes ease in and out, so this is a fraction rather than a switch.
  const strength = Math.max(Math.abs(steerX), Math.abs(steerY));

  return {
    // Negated: see above. The commanded heading is led far enough ahead of the
    // current one that the turn-rate limit is always what governs the turn.
    yaw: currentYaw - steerX * 1.2,
    // With no vertical key held this is level, so the animal eases back to flat
    // rather than holding whatever climb it was last given. A pitch that sticks
    // is trimming rather than steering, and only one of those is restful to use.
    pitch: steerY * SWIM.keySteerMaxPitch,
    turnRate: turnRate * strength,
  };
}

/**
 * The world direction that is "right" on screen for a given heading.
 *
 * The camera sits behind the animal looking along its heading, so screen right
 * is `cross(forward, up)` — the same relation Three's own camera obeys, where a
 * camera looking down −Z has its local +X on world +X.
 */
export function screenRight(yaw: number): { x: number; z: number } {
  // forward = (sin y, 0, cos y), up = (0, 1, 0)
  // cross(forward, up) = (0·0 − cos y·1, …, sin y·1 − 0·0) = (−cos y, 0, sin y)
  return { x: -Math.cos(yaw), z: Math.sin(yaw) };
}
