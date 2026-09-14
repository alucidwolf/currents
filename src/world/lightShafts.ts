import * as THREE from "three";
import { WORLD } from "../core/config";
import { mulberry32 } from "../core/rng";

/**
 * Sunlight breaking through the surface.
 *
 * These are not volumetrics — no raymarching, no render targets, no depth
 * buffer tricks. Each shaft is a single additive quad hanging from the surface,
 * faded top-to-bottom and edge-to-centre in the fragment shader. A handful of
 * them, set at different angles and drifting slowly, is enough to read as god
 * rays from any viewpoint.
 *
 * They travel with the swimmer, so there is always light somewhere overhead no
 * matter how far the ocean has been crossed.
 */

const SHAFT_COUNT = 9;
const SPREAD = 62;

const VERTEX = /* glsl */ `
  varying vec2 vShaftUv;
  varying float vShaftDistance;

  void main() {
    vShaftUv = uv;
    vec4 viewPosition = modelViewMatrix * vec4( position, 1.0 );
    vShaftDistance = -viewPosition.z;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uFadeStart;
  uniform float uFadeEnd;

  varying vec2 vShaftUv;
  varying float vShaftDistance;

  void main() {
    // Brightest where it enters the water, gone well before the seabed.
    float vertical = pow( clamp( vShaftUv.y, 0.0, 1.0 ), 2.1 );

    // Soft edges: a hard-edged quad would read as a sheet of glass.
    float horizontal = sin( clamp( vShaftUv.x, 0.0, 1.0 ) * 3.14159 );
    horizontal = pow( horizontal, 2.4 );

    // A slow breathing flicker, as the surface above moves.
    float flicker = 0.78 + 0.22 * sin( uTime * 0.6 + vShaftUv.x * 4.0 );

    // Without fog on an additive material, distant shafts would stack up into
    // a bright haze; fading them by view distance keeps the horizon clean.
    float distanceFade = 1.0 - smoothstep( uFadeStart, uFadeEnd, vShaftDistance );

    float alpha = vertical * horizontal * flicker * distanceFade * uOpacity;
    if ( alpha < 0.002 ) discard;

    gl_FragColor = vec4( uColor * alpha, alpha );
  }
`;

export class LightShafts {
  private readonly group = new THREE.Group();
  private readonly shafts: Array<{ mesh: THREE.Mesh; offset: THREE.Vector2; spin: number }> =
    [];
  private readonly uniforms = {
    uColor: { value: new THREE.Color(0xbfe9ff) },
    uOpacity: { value: 0.3 },
    uTime: { value: 0 },
    uFadeStart: { value: 60 },
    uFadeEnd: { value: 165 },
  };

  private readonly material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, seed: number) {
    const rng = mulberry32(seed ^ 0x3c6ef372);

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      // Additive so shafts brighten the water rather than occluding it, and
      // depth-write off so they never cut holes in anything behind them.
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const height = Math.abs(WORLD.seabedY) * 0.86;

    for (let i = 0; i < SHAFT_COUNT; i++) {
      const width = 5 + rng() * 11;
      const geometry = new THREE.PlaneGeometry(width, height, 1, 1);
      // Hang from the surface: pivot at the top edge.
      geometry.translate(0, -height / 2, 0);

      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.rotation.y = rng() * Math.PI;
      // A slight tilt, as refracted light would not fall perfectly vertically.
      mesh.rotation.z = (rng() - 0.5) * 0.22;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;

      this.group.add(mesh);
      this.shafts.push({
        mesh,
        offset: new THREE.Vector2((rng() - 0.5) * SPREAD * 2, (rng() - 0.5) * SPREAD * 2),
        spin: (rng() - 0.5) * 0.03,
      });
    }

    scene.add(this.group);
  }

  update(dt: number, elapsed: number, swimmerPosition: THREE.Vector3): void {
    this.uniforms.uTime.value = elapsed;

    for (const shaft of this.shafts) {
      shaft.mesh.position.set(
        swimmerPosition.x + shaft.offset.x,
        WORLD.surfaceY,
        swimmerPosition.z + shaft.offset.y,
      );
      // Turning slowly keeps them from looking like fixed scenery bolted to
      // the camera, which is what a purely static offset would read as.
      shaft.mesh.rotation.y += shaft.spin * dt;
    }
  }

  dispose(): void {
    for (const shaft of this.shafts) shaft.mesh.geometry.dispose();
    this.material.dispose();
  }
}
