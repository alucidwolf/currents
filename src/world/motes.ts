import * as THREE from "three";

/**
 * Suspended particulate — the specks of drifting matter in any real body of
 * water.
 *
 * Cheaper than anything else in the project and disproportionately effective:
 * a few hundred slowly moving points give the water a sense of depth, motion
 * and scale that geometry alone cannot. Without them, swimming through open
 * water looks like standing still in fog.
 *
 * The field is a box that travels with the swimmer. Points that fall out of one
 * face are wrapped round to the opposite one, so a finite set of particles
 * covers an infinite ocean and nothing is ever left behind.
 */
const COUNT = 900;
const BOX = 90;

/** How the specks look by day, and when they glow at night. */
const DAY_COLOR = new THREE.Color(0xcfe8f0);
const GLOW_COLOR = new THREE.Color(0x8ff5e4);
const DAY_OPACITY = 0.42;
const GLOW_OPACITY = 0.9;
const DAY_SIZE = 0.12;
const GLOW_SIZE = 0.19;

export class Motes {
  private readonly points: THREE.Points;
  private readonly material: THREE.PointsMaterial;
  private readonly positions: Float32Array;
  private readonly drift = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();

  constructor(scene: THREE.Scene, swimmerPosition: THREE.Vector3) {
    this.positions = new Float32Array(COUNT * 3);
    this.centre.copy(swimmerPosition);

    for (let i = 0; i < COUNT; i++) {
      this.positions[i * 3] = swimmerPosition.x + (Math.random() - 0.5) * BOX;
      this.positions[i * 3 + 1] = swimmerPosition.y + (Math.random() - 0.5) * BOX;
      this.positions[i * 3 + 2] = swimmerPosition.z + (Math.random() - 0.5) * BOX;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));

    this.material = new THREE.PointsMaterial({
      color: DAY_COLOR.clone(),
      size: DAY_SIZE,
      sizeAttenuation: true,
      transparent: true,
      opacity: DAY_OPACITY,
      depthWrite: false,
      fog: true,
    });

    this.points = new THREE.Points(geometry, this.material);
    // The field is always centred on the swimmer, so culling it is pointless
    // work and its bounding sphere would need recomputing every frame anyway.
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /**
   * Bioluminescence, 0 by day to 1 at night.
   *
   * The same specks, not a second set: by day they are dust in the light, and
   * as the light goes they take over as the brightest things in the water.
   */
  setGlow(glow: number): void {
    this.material.color.copy(DAY_COLOR).lerp(GLOW_COLOR, glow);
    this.material.opacity = DAY_OPACITY + (GLOW_OPACITY - DAY_OPACITY) * glow;
    this.material.size = DAY_SIZE + (GLOW_SIZE - DAY_SIZE) * glow;
  }

  update(
    dt: number,
    swimmerPosition: THREE.Vector3,
    currentDirection: THREE.Vector3,
    currentStrength: number,
  ): void {
    this.centre.copy(swimmerPosition);
    this.drift
      .copy(currentDirection)
      .multiplyScalar(currentStrength * 1.15 * dt);
    // A slight downward settle, as suspended matter would.
    this.drift.y -= 0.06 * dt;

    const half = BOX / 2;

    for (let i = 0; i < COUNT; i++) {
      const xi = i * 3;
      const yi = xi + 1;
      const zi = xi + 2;

      this.positions[xi]! += this.drift.x;
      this.positions[yi]! += this.drift.y;
      this.positions[zi]! += this.drift.z;

      // Wrap around the travelling box rather than respawning randomly, which
      // would make particles visibly pop in and out at the edges of view.
      let dx = this.positions[xi]! - this.centre.x;
      let dy = this.positions[yi]! - this.centre.y;
      let dz = this.positions[zi]! - this.centre.z;

      if (dx > half) dx -= BOX;
      else if (dx < -half) dx += BOX;
      if (dy > half) dy -= BOX;
      else if (dy < -half) dy += BOX;
      if (dz > half) dz -= BOX;
      else if (dz < -half) dz += BOX;

      this.positions[xi] = this.centre.x + dx;
      this.positions[yi] = this.centre.y + dy;
      this.positions[zi] = this.centre.z + dz;
    }

    (this.points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate =
      true;
  }
}
