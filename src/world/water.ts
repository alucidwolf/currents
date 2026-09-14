import * as THREE from "three";
import { WATER, WORLD } from "../core/config";

/**
 * The feeling of being underwater, assembled from cheap parts.
 *
 * There is no fluid simulation anywhere in this project. What sells the water
 * is four things working together: exponential fog that limits sight the way
 * turbidity does, a colour that shifts from teal to deep blue as you descend,
 * light that dims with it, and a shimmering ceiling overhead to orient by.
 *
 * The surface plane follows the swimmer in X and Z. It is a ceiling, not a
 * place — there is no edge to find, and no need for one to exist.
 */
export class Water {
  private readonly shallow = new THREE.Color(WATER.shallowColor);
  private readonly deep = new THREE.Color(WATER.deepColor);
  private readonly tint = new THREE.Color();

  private readonly fog: THREE.FogExp2;
  private readonly ambient: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly surface: THREE.Mesh;
  private readonly surfaceUniforms = {
    uSurfaceTime: { value: 0 },
  };

  constructor(private readonly scene: THREE.Scene) {
    this.fog = new THREE.FogExp2(WATER.shallowColor, WATER.fogDensity);
    scene.fog = this.fog;
    scene.background = this.shallow.clone();

    this.ambient = new THREE.HemisphereLight(
      WATER.shallowColor,
      WATER.groundColor,
      WATER.ambientIntensity,
    );
    scene.add(this.ambient);

    // A directional light points from its position toward its target, and the
    // target defaults to the world origin. Left alone, that means the "sun"
    // would swing round to shine sideways once the swimmer is a few hundred
    // metres out. Both ends travel with the swimmer so the direction is fixed.
    this.sun = new THREE.DirectionalLight(WATER.sunColor, WATER.sunIntensity);
    // A single tight shadow frustum, kept small because it travels with the
    // swimmer and never has to cover more than the animal's own surroundings.
    // A wide one would spread the same texels over hundreds of metres and turn
    // the shadow to mush.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(WATER.shadowMapSize, WATER.shadowMapSize);
    const frustum = this.sun.shadow.camera;
    frustum.left = -WATER.shadowExtent;
    frustum.right = WATER.shadowExtent;
    frustum.top = WATER.shadowExtent;
    frustum.bottom = -WATER.shadowExtent;
    frustum.near = 1;
    frustum.far = 220;
    // Softens the contact edge and hides the seam where the shadow of an
    // animated body disagrees slightly with the body itself.
    this.sun.shadow.radius = WATER.shadowSoftness;
    this.sun.shadow.bias = -0.0022;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // A dim fill from below and behind keeps flanks from going to silhouette;
    // without it, anything seen side-on against open water reads as a hole.
    this.fill = new THREE.DirectionalLight(WATER.fillColor, WATER.fillIntensity);
    scene.add(this.fill);
    scene.add(this.fill.target);

    this.surface = this.createSurface();
    scene.add(this.surface);
  }

  update(dt: number, swimmerPosition: THREE.Vector3): void {
    this.surfaceUniforms.uSurfaceTime.value += dt;

    const depth = Math.max(0, WORLD.surfaceY - swimmerPosition.y);
    const t = THREE.MathUtils.clamp(depth / WATER.tintDepth, 0, 1);
    // Squaring biases the gradient toward the shallows, where most of the
    // swimming happens, so the colour change is actually noticeable there.
    const eased = t * t * 0.65 + t * 0.35;

    this.tint.copy(this.shallow).lerp(this.deep, eased);
    this.fog.color.copy(this.tint);
    (this.scene.background as THREE.Color).copy(this.tint);

    this.ambient.color.copy(this.tint).lerp(this.shallow, 0.55);
    this.ambient.intensity = WATER.ambientIntensity * (1 - eased * 0.35);
    this.sun.intensity = WATER.sunIntensity * (1 - eased * 0.5);
    this.fill.intensity = WATER.fillIntensity * (1 - eased * 0.35);

    // Both lights ride along with the swimmer, keeping their directions
    // constant no matter how far the world has been travelled.
    this.sun.target.position.copy(swimmerPosition);
    this.sun.position.set(
      swimmerPosition.x + 26,
      swimmerPosition.y + 80,
      swimmerPosition.z + 14,
    );

    this.fill.target.position.copy(swimmerPosition);
    this.fill.position.set(
      swimmerPosition.x - 40,
      swimmerPosition.y - 22,
      swimmerPosition.z - 30,
    );

    // Keep the ceiling overhead no matter how far we roam.
    this.surface.position.x = swimmerPosition.x;
    this.surface.position.z = swimmerPosition.z;
  }

  private createSurface(): THREE.Mesh {
    // Sized to comfortably exceed the fog distance in every direction.
    const geometry = new THREE.PlaneGeometry(900, 900, 1, 1);
    geometry.rotateX(Math.PI / 2);

    const material = new THREE.MeshLambertMaterial({
      color: 0xc4eef8,
      transparent: true,
      opacity: 0.5,
      // Seen only from below; culling the top face avoids drawing it twice
      // when the camera orbits above the swimmer near the surface.
      side: THREE.BackSide,
      depthWrite: false,
    });

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uSurfaceTime = this.surfaceUniforms.uSurfaceTime;

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vSurfWorld;")
        .replace(
          "#include <project_vertex>",
          "#include <project_vertex>\nvSurfWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;",
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
           uniform float uSurfaceTime;
           varying vec3 vSurfWorld;`,
        )
        .replace(
          "#include <opaque_fragment>",
          `#include <opaque_fragment>
           {
             vec2 p = vSurfWorld.xz * 0.055;
             float t = uSurfaceTime;
             float ripple =
               sin( p.x * 1.4 + t * 0.75 ) * sin( p.y * 1.2 - t * 0.55 ) +
               sin( ( p.x - p.y ) * 0.8 + t * 0.95 ) * 0.6;
             ripple = ripple * 0.25 + 0.55;
             gl_FragColor.rgb *= 0.75 + ripple * 0.55;
           }`,
        );
    };

    material.customProgramCacheKey = () => "currents-surface";

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = WORLD.surfaceY;
    mesh.renderOrder = -1;
    return mesh;
  }
}
