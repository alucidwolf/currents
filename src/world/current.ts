import * as THREE from "three";
import { fbm1Signed } from "./noise";

/**
 * One slowly rotating drift vector, shared by everything that should look like
 * it is sitting in moving water.
 *
 * This is the trick that ties the scene together. Kelp leans on it, the
 * particulate drifts along it, and the swimmer feels a faint push from it — so
 * although nothing here simulates fluid, every loose thing in view agrees about
 * which way the water is going. Disagreement is what would break the illusion;
 * a single shared vector makes disagreement impossible.
 */
export class Current {
  /** Unit direction in the XZ plane. */
  readonly direction = new THREE.Vector3(1, 0, 0);
  /** Scalar strength in [0.35, 1], for shader amplitude. */
  strength = 0.7;

  private angle = 0;

  constructor(private readonly seed: number) {}

  update(elapsed: number): void {
    // A very slow wander, so the current's heading takes minutes to change
    // appreciably rather than visibly swinging about.
    this.angle = fbm1Signed(elapsed * 0.006, this.seed ^ 0x7f4a7c15, 2) * Math.PI;
    this.direction.set(Math.sin(this.angle), 0, Math.cos(this.angle));

    const pulse = fbm1Signed(elapsed * 0.02, this.seed ^ 0x1d8e4e27, 2);
    this.strength = 0.68 + pulse * 0.32;
  }

  /** Gentle push applied to the swimmer, in world units per second. */
  drift(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.direction).multiplyScalar(this.strength * 0.35);
  }
}
