import * as THREE from "three";
import { SWIM, WANDER, WORLD } from "../core/config";
import { fbm1Signed } from "../world/noise";
import type { Terrain } from "../world/terrain";
import type { SteerCommand, Swimmer } from "./swimmer";

/** Somewhere worth drifting past. Supplied by the world once scenery exists. */
export interface PointOfInterest {
  /** Stable identity, so a place already visited is not chased again. */
  key: string;
  position: THREE.Vector3;
  /** Relative appeal. A fish school outranks a lone rock. */
  weight: number;
}

export type PoiProvider = (
  near: THREE.Vector3,
  radius: number,
  out: PointOfInterest[],
) => void;

const SEED_YAW = 0x51ed270b;
const SEED_PITCH = 0x1b873593;

/** How close counts as "seen it", after which curiosity moves on. */
const POI_ARRIVAL_RADIUS = 22;
/** Seconds before somewhere already visited becomes interesting again. */
const POI_MEMORY_SECONDS = 420;

/**
 * The autopilot.
 *
 * This is what makes the game a screensaver rather than a toy: with no input
 * at all it must swim indefinitely, never stall, never grind along the seabed,
 * and — the hard part — never settle into a lazy loop over one patch of floor.
 *
 * Four influences combine each frame:
 *
 *   1. Meander       smooth noise, for organic curves rather than straight lines
 *   2. Anti-circling repulsion from where it has recently been
 *   3. Avoidance     terrain and surface, steering early and gently
 *   4. Curiosity     a weak pull toward scenery worth passing
 *
 * Only avoidance is allowed to be assertive. The rest are nudges, because the
 * whole point is that nothing ever looks urgent.
 */
export class Wander {
  private readonly trail: THREE.Vector3[] = [];
  private trailWrite = 0;
  private trailTimer = 0;

  private readonly visited = new Map<string, number>();
  private target: PointOfInterest | null = null;

  private poiProvider: PoiProvider | null = null;
  private readonly poiScratch: PointOfInterest[] = [];

  private readonly forward = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly repulsion = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();

  constructor(
    private readonly terrain: Terrain,
    private readonly seed: number,
  ) {}

  setPoiProvider(provider: PoiProvider | null): void {
    this.poiProvider = provider;
  }

  /** Currently chased point of interest, for debugging and the perf overlay. */
  get currentTargetKey(): string | null {
    return this.target?.key ?? null;
  }

  update(dt: number, elapsed: number, swimmer: Swimmer): SteerCommand {
    swimmer.forward(this.forward);

    this.recordTrail(dt, swimmer.position);
    this.expireMemory(elapsed);

    // --- 1. Meander ----------------------------------------------------------
    // A heading *offset* rather than an absolute target: noise near zero means
    // hold course, noise at the extremes means a long lazy arc. The turn-rate
    // limiter downstream turns this into a curve rather than a swerve.
    const yawNoise = fbm1Signed(elapsed * WANDER.yawNoiseFrequency, this.seed ^ SEED_YAW);
    const pitchNoise = fbm1Signed(
      elapsed * WANDER.pitchNoiseFrequency,
      this.seed ^ SEED_PITCH,
    );

    let desiredYaw = swimmer.yaw + yawNoise * WANDER.meanderStrength;
    let desiredPitch = pitchNoise * WANDER.maxPitch;

    // --- 2. Anti-circling ----------------------------------------------------
    // Noise steering, left alone, random-walks into orbits over the same few
    // hundred square metres. Pushing away from the recent trail is what turns
    // that orbit back into exploration.
    this.computeRepulsion(swimmer.position);
    if (this.repulsion.lengthSq() > 1e-6) {
      this.desired.set(Math.sin(desiredYaw), 0, Math.cos(desiredYaw));
      this.desired.addScaledVector(this.repulsion, WANDER.trailStrength);
      if (this.desired.lengthSq() > 1e-6) {
        desiredYaw = Math.atan2(this.desired.x, this.desired.z);
      }
    }

    // --- 4. Curiosity --------------------------------------------------------
    // Applied before avoidance so that avoidance always has the last word.
    const curiosityYaw = this.updateCuriosity(elapsed, swimmer.position);
    if (curiosityYaw !== null) {
      this.desired.set(Math.sin(desiredYaw), 0, Math.cos(desiredYaw));
      this.desired.x += Math.sin(curiosityYaw) * WANDER.curiosityStrength;
      this.desired.z += Math.cos(curiosityYaw) * WANDER.curiosityStrength;
      if (this.desired.lengthSq() > 1e-6) {
        desiredYaw = Math.atan2(this.desired.x, this.desired.z);
      }
    }

    // --- 3. Avoidance --------------------------------------------------------
    desiredPitch = this.applyVerticalAvoidance(swimmer, desiredPitch);
    desiredYaw = this.applyLateralAvoidance(swimmer, desiredYaw);

    return {
      yaw: desiredYaw,
      pitch: THREE.MathUtils.clamp(desiredPitch, -0.8, 0.8),
      turnRate: SWIM.wanderTurnRate,
    };
  }

  /** Called when the player takes over, so the trail does not go stale. */
  recordPlayerPosition(dt: number, position: THREE.Vector3): void {
    this.recordTrail(dt, position);
  }

  // -- internals -------------------------------------------------------------

  private recordTrail(dt: number, position: THREE.Vector3): void {
    this.trailTimer += dt;
    if (this.trailTimer < WANDER.trailSampleInterval) return;
    this.trailTimer = 0;

    if (this.trail.length < WANDER.trailPoints) {
      this.trail.push(position.clone());
    } else {
      this.trail[this.trailWrite]!.copy(position);
      this.trailWrite = (this.trailWrite + 1) % WANDER.trailPoints;
    }
  }

  /**
   * Sum of horizontal pushes away from recent positions, with a smooth falloff
   * so the influence fades rather than switching off at the radius edge.
   */
  private computeRepulsion(position: THREE.Vector3): void {
    this.repulsion.set(0, 0, 0);

    const radiusSq = WANDER.trailRadius * WANDER.trailRadius;
    for (const point of this.trail) {
      const dx = position.x - point.x;
      const dz = position.z - point.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > radiusSq || distSq < 1e-4) continue;

      const falloff = 1 - distSq / radiusSq;
      const dist = Math.sqrt(distSq);
      this.repulsion.x += (dx / dist) * falloff * falloff;
      this.repulsion.z += (dz / dist) * falloff * falloff;
    }

    // Normalising keeps behaviour identical whether 3 or 28 samples are in range.
    const len = Math.hypot(this.repulsion.x, this.repulsion.z);
    if (len > 1e-6) {
      this.repulsion.x /= len;
      this.repulsion.z /= len;
    }
  }

  /**
   * Probe the seabed along the projected path and start climbing early.
   *
   * Sampling several points and taking the steepest requirement means a ridge
   * is answered by one wide arc begun far out, not a panicked pull-up at the
   * last metre.
   */
  private applyVerticalAvoidance(swimmer: Swimmer, desiredPitch: number): number {
    const pos = swimmer.position;
    let climbNeed = 0;
    let diveNeed = 0;

    const floorTarget = SWIM.seabedClearance + 3.5;
    const ceilY = WORLD.surfaceY - SWIM.surfaceClearance - 2.5;

    for (let i = 1; i <= WANDER.lookaheadSamples; i++) {
      const t = (i / WANDER.lookaheadSamples) * WANDER.lookaheadDistance;
      const px = pos.x + this.forward.x * t;
      const pz = pos.z + this.forward.z * t;
      const projectedY = pos.y + this.forward.y * t;

      const floorAhead = this.terrain.heightAt(px, pz) + floorTarget;
      if (projectedY < floorAhead) {
        climbNeed = Math.max(climbNeed, (floorAhead - projectedY) / t);
      }
      if (projectedY > ceilY) {
        diveNeed = Math.max(diveNeed, (projectedY - ceilY) / t);
      }
    }

    if (climbNeed > 0) {
      const climbPitch = Math.atan(climbNeed * WANDER.avoidStrength);
      desiredPitch = Math.max(desiredPitch, Math.min(climbPitch, 0.8));
    }
    if (diveNeed > 0) {
      const divePitch = Math.atan(diveNeed * WANDER.avoidStrength);
      desiredPitch = Math.min(desiredPitch, -Math.min(divePitch, 0.8));
    }

    return desiredPitch;
  }

  /**
   * Prefer going *around* rising ground over going over it.
   *
   * Cheap: two extra height samples, one to each side. When the floor ahead is
   * climbing, this biases the heading toward whichever flank is deeper, which
   * reads as an animal following a valley rather than bulldozing a hill.
   */
  private applyLateralAvoidance(swimmer: Swimmer, desiredYaw: number): number {
    const pos = swimmer.position;
    const reach = WANDER.lookaheadDistance * 0.8;
    const spread = 0.85;

    const aheadY = this.terrain.heightAt(
      pos.x + this.forward.x * reach,
      pos.z + this.forward.z * reach,
    );

    // Only worth doing when there is actually something in the way.
    if (aheadY < pos.y - SWIM.seabedClearance - 6) return desiredYaw;

    const leftYaw = swimmer.yaw - spread;
    const rightYaw = swimmer.yaw + spread;

    const leftY = this.terrain.heightAt(
      pos.x + Math.sin(leftYaw) * reach,
      pos.z + Math.cos(leftYaw) * reach,
    );
    const rightY = this.terrain.heightAt(
      pos.x + Math.sin(rightYaw) * reach,
      pos.z + Math.cos(rightYaw) * reach,
    );

    const bias = (leftY - rightY) * 0.05;
    return desiredYaw + THREE.MathUtils.clamp(bias, -0.6, 0.6);
  }

  /**
   * Pick and pursue somewhere mildly interesting.
   *
   * Returns a yaw toward the current target, or null when nothing appeals. The
   * pull is weak on purpose — it should look like the animal happened to swim
   * past the coral, not like it was summoned.
   */
  private updateCuriosity(elapsed: number, position: THREE.Vector3): number | null {
    if (!this.poiProvider) return null;

    if (this.target) {
      this.toTarget.copy(this.target.position).sub(position);
      const dist = this.toTarget.length();

      if (dist < POI_ARRIVAL_RADIUS) {
        this.visited.set(this.target.key, elapsed + POI_MEMORY_SECONDS);
        this.target = null;
      } else if (dist > WANDER.curiosityRadius * 1.6) {
        // Drifted away from it; stop pretending we are still headed there.
        this.target = null;
      } else {
        return Math.atan2(this.toTarget.x, this.toTarget.z);
      }
    }

    this.poiScratch.length = 0;
    this.poiProvider(position, WANDER.curiosityRadius, this.poiScratch);

    let best: PointOfInterest | null = null;
    let bestScore = 0;

    for (const poi of this.poiScratch) {
      if (this.visited.has(poi.key)) continue;

      const dist = poi.position.distanceTo(position);
      if (dist < POI_ARRIVAL_RADIUS || dist > WANDER.curiosityRadius) continue;

      // Nearer and more appealing wins, but never so decisively that the animal
      // beelines; the score only chooses a direction, not a speed.
      const score = poi.weight / (1 + dist * 0.02);
      if (score > bestScore) {
        bestScore = score;
        best = poi;
      }
    }

    if (!best) return null;

    this.target = best;
    this.toTarget.copy(best.position).sub(position);
    return Math.atan2(this.toTarget.x, this.toTarget.z);
  }

  private expireMemory(elapsed: number): void {
    if (this.visited.size === 0) return;
    for (const [key, expiry] of this.visited) {
      if (expiry <= elapsed) this.visited.delete(key);
    }
  }
}
