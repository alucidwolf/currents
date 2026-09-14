import * as THREE from "three";
import { SWIM, WORLD } from "../core/config";
import type { Terrain } from "../world/terrain";

const TWO_PI = Math.PI * 2;

/** Shortest signed angular difference from `a` to `b`, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

export interface SteerCommand {
  yaw: number;
  pitch: number;
  /** Radians per second this command is allowed to turn at. */
  turnRate: number;
}

/**
 * The animal's body state.
 *
 * Heading is stored as yaw/pitch rather than a quaternion: both steering
 * sources naturally produce a direction, turn-rate limiting is trivial on
 * scalars, and gimbal lock is not reachable because pitch is clamped well
 * short of vertical. Roll is presentation only — it is derived from how hard
 * the animal is turning, never integrated.
 */
export class Swimmer {
  readonly position = new THREE.Vector3(0, WORLD.seabedY * 0.45, 0);
  readonly object = new THREE.Group();

  yaw = 0;
  pitch = 0;
  roll = 0;
  speed: number = SWIM.cruiseSpeed;

  /** True on any frame the seabed or surface clamp had to intervene. */
  clamped = false;

  private bodyOffset = 0;

  constructor(private readonly terrain: Terrain) {
    this.object.position.copy(this.position);
  }

  /** Unit heading vector. Allocates nothing. */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  update(dt: number, elapsed: number, command: SteerCommand): void {
    // --- Turn toward the commanded heading, rate limited ---------------------
    const maxTurn = command.turnRate * dt;

    const yawError = angleDelta(this.yaw, command.yaw);
    const yawStep = THREE.MathUtils.clamp(yawError, -maxTurn, maxTurn);
    this.yaw += yawStep;

    const pitchError = command.pitch - this.pitch;
    const pitchStep = THREE.MathUtils.clamp(pitchError, -maxTurn, maxTurn);
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchStep, -0.85, 0.85);

    // --- Bank into the turn --------------------------------------------------
    // Roll follows yaw *rate*, so the body leans while turning and levels out
    // the moment it stops. Easing prevents a twitchy roll on sharp inputs.
    const yawRate = dt > 0 ? yawStep / dt : 0;
    const targetRoll = THREE.MathUtils.clamp(
      -yawRate * SWIM.bankStrength,
      -SWIM.maxBank,
      SWIM.maxBank,
    );
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 3.4);

    // --- Cruise --------------------------------------------------------------
    // A slow sine on speed keeps long stretches from looking metronomic.
    const breath = Math.sin((elapsed / SWIM.speedBreathPeriod) * TWO_PI);
    this.speed = SWIM.cruiseSpeed * (1 + breath * SWIM.speedBreathAmount);

    const forward = this.forward();
    this.position.addScaledVector(forward, this.speed * dt);

    // --- Hard safety clamps --------------------------------------------------
    // The autopilot's lookahead should mean these never fire. They exist so a
    // failure there degrades into "skims the floor" rather than "swims through
    // solid rock", which is the difference between a blemish and a broken scene.
    this.clamped = false;

    const floorY = this.terrain.heightAt(this.position.x, this.position.z) + SWIM.seabedClearance;
    if (this.position.y < floorY) {
      this.position.y = floorY;
      this.pitch = Math.max(this.pitch, 0.1);
      this.clamped = true;
    }

    const ceilY = WORLD.surfaceY - SWIM.surfaceClearance;
    if (this.position.y > ceilY) {
      this.position.y = ceilY;
      this.pitch = Math.min(this.pitch, -0.1);
      this.clamped = true;
    }

    // --- Present -------------------------------------------------------------
    // Bob is applied to the rendered body only, never to the logical position,
    // so it can never push the animal through a clamp it just satisfied.
    this.bodyOffset = Math.sin((elapsed / SWIM.bobPeriod) * TWO_PI) * SWIM.bobAmount;

    this.object.position.set(
      this.position.x,
      this.position.y + this.bodyOffset,
      this.position.z,
    );
    this.object.rotation.set(-this.pitch, this.yaw, this.roll, "YXZ");
  }

  /** Depth below the surface, always >= 0. Drives the water tint. */
  get depth(): number {
    return Math.max(0, WORLD.surfaceY - this.position.y);
  }

  /** Height of the seabed directly beneath the animal. */
  get floorHeight(): number {
    return this.terrain.heightAt(this.position.x, this.position.z);
  }
}
