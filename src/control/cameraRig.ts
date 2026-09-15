import * as THREE from "three";
import { CAMERA, WORLD } from "../core/config";
import { angleDelta } from "../creatures/swimmer";
import type { Swimmer } from "../creatures/swimmer";
import type { Terrain } from "../world/terrain";
import type { Input } from "./input";

/**
 * A lazy follow camera.
 *
 * The orbit offset is stored *relative to the animal's heading*, so the camera
 * naturally ends up behind it again after a turn — but the heading it follows
 * is itself eased, which is what stops the world from whipping around during a
 * hard turn. The result trails like a camera boat rather than a rigid mount.
 *
 * Left-drag orbits, the wheel zooms, and after a spell of no input the whole
 * rig begins a very slow drift of its own. That last part is the difference
 * between "a fixed view of a fish" and something worth leaving on a monitor.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;

  private orbitYaw: number = CAMERA.startYaw;
  private orbitPitch: number = CAMERA.startPitch;
  private distance: number = CAMERA.startDistance;

  /** Eased copy of the swimmer's heading. The source of the trailing feel. */
  private followYaw = 0;

  private readonly target = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private idlePhase = 0;

  constructor(
    aspect: number,
    private readonly terrain: Terrain,
  ) {
    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fov,
      aspect,
      CAMERA.near,
      CAMERA.far,
    );
  }

  /**
   * Hold a camera position inside the water.
   *
   * Orbiting down swings the camera below the animal, and at any usual distance
   * that is far enough below to pass through the seabed. What you see from
   * under it is not rock — back faces are culled, so the ground simply is not
   * there and you are looking out at open water through a hole.
   *
   * Raising the camera rather than pulling it in is deliberate. The boom also
   * shortens horizontally as the pitch steepens, so a camera held at floor
   * level keeps closing on the animal as you drag, and ends up looking up at it
   * from just above the sand — a real shot, and one you arrive at by continuing
   * to drag rather than by hitting a wall.
   *
   * The floor is applied last so it wins: in water shallow enough that the two
   * bounds cross, being briefly out of the water is a far smaller problem than
   * being inside the ground.
   */
  private keepInWater(position: THREE.Vector3): void {
    const ceiling = WORLD.surfaceY - CAMERA.airClearance;
    if (position.y > ceiling) position.y = ceiling;

    const floor = this.terrain.heightAt(position.x, position.z) + CAMERA.floorClearance;
    if (position.y < floor) position.y = floor;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Back off far enough for a newly adopted animal, and no further.
   *
   * A floor rather than a setting. Animals can now be swapped mid-swim, and
   * snapping the zoom back to each one's preferred framing would throw away
   * whatever the player had chosen to look at — every swap yanking the view is
   * a worse cost than a whale occasionally being framed wider than ideal. So
   * this only ever pushes the camera out, and only when the animal would
   * otherwise be too big to see: at six units, most of a humpback is behind
   * you.
   */
  ensureRoomFor(minimumDistance: number): void {
    const floor = THREE.MathUtils.clamp(
      minimumDistance,
      CAMERA.minDistance,
      CAMERA.maxDistance,
    );
    if (this.distance < floor) this.distance = floor;
  }

  update(dt: number, input: Input, swimmer: Swimmer): void {
    // --- Player orbit --------------------------------------------------------
    if (input.dragX !== 0 || input.dragY !== 0) {
      this.orbitYaw -= input.dragX * CAMERA.dragSensitivity;
      this.orbitPitch = THREE.MathUtils.clamp(
        this.orbitPitch + input.dragY * CAMERA.dragSensitivity,
        CAMERA.minPitch,
        CAMERA.maxPitch,
      );
    }

    if (input.wheel !== 0) {
      this.distance = THREE.MathUtils.clamp(
        this.distance * (1 + input.wheel * 0.0011),
        CAMERA.minDistance,
        CAMERA.maxDistance,
      );
    }

    // --- Idle drift ----------------------------------------------------------
    // Only after a genuine pause, and cancelled by the first flicker of input.
    if (CAMERA.idleEnabled && input.idleTime > CAMERA.idleDelay) {
      // Ease in over a few seconds so the drift never visibly "switches on".
      const ramp = Math.min(1, (input.idleTime - CAMERA.idleDelay) / 4);
      this.orbitYaw += CAMERA.idleDriftSpeed * ramp * dt;

      this.idlePhase += dt * 0.055;
      const driftPitch = 0.22 + Math.sin(this.idlePhase) * 0.26;
      this.orbitPitch += (driftPitch - this.orbitPitch) * Math.min(1, dt * 0.12 * ramp);
    }

    // --- Trail the heading ---------------------------------------------------
    // Easing the *followed* heading rather than the camera position is what
    // makes turns feel unhurried without making the camera feel sluggish.
    const follow = 1 - Math.exp(-dt / CAMERA.followLag);
    this.followYaw += angleDelta(this.followYaw, swimmer.yaw) * follow;

    // --- Place ---------------------------------------------------------------
    // Aim slightly ahead of the body so the animal sits low in frame with the
    // water it is swimming into visible, rather than dead centre.
    this.target.copy(swimmer.object.position);
    this.target.y += 1.1;

    const yaw = this.followYaw + this.orbitYaw;
    const cp = Math.cos(this.orbitPitch);

    this.desiredPosition.set(
      this.target.x + Math.sin(yaw) * cp * this.distance,
      this.target.y + Math.sin(this.orbitPitch) * this.distance,
      this.target.z + Math.cos(yaw) * cp * this.distance,
    );

    this.keepInWater(this.desiredPosition);

    // A light positional ease on top absorbs the speed "breathing" so the
    // camera does not visibly pump back and forth.
    const ease = 1 - Math.exp(-dt / 0.16);
    this.camera.position.lerp(this.desiredPosition, ease);

    // Again after easing, and this is the one that actually guarantees it. The
    // lerp can cut a corner through ground that neither end was inside, and the
    // seabed can just as easily rise into a camera that never moved.
    this.keepInWater(this.camera.position);

    this.camera.lookAt(this.target);
  }
}
