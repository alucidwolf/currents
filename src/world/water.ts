import * as THREE from "three";
import { WATER, WORLD } from "../core/config";

/** Inlined into the surface shader, which cannot read the config at runtime. */
const SURFACE_CRITICAL = WATER.surfaceCritical.toFixed(3);
const SURFACE_FADE_NEAR = WATER.surfaceFadeNear.toFixed(1);
const SURFACE_FADE_FAR = WATER.surfaceFadeFar.toFixed(1);

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
  /** Endpoints the horizon ramp leans toward, above and below eye level. */
  private readonly surfaceLight = new THREE.Color(WATER.surfaceGlow);
  private readonly abyss = new THREE.Color(WATER.deepColor).multiplyScalar(0.45);

  private readonly fog: THREE.FogExp2;
  private readonly ambient: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly surface: THREE.Mesh;
  private readonly backdrop: THREE.Mesh;
  private readonly surfaceUniforms = {
    uSurfaceTime: { value: 0 },
    uGlow: { value: new THREE.Color(WATER.surfaceGlow) },
    uMirror: { value: new THREE.Color(WATER.surfaceMirror) },
  };
  private readonly backdropUniforms = {
    uHorizon: { value: new THREE.Color(WATER.shallowColor) },
    uAbove: { value: new THREE.Color(WATER.shallowColor) },
    uBelow: { value: new THREE.Color(WATER.deepColor) },
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

    this.backdrop = this.createBackdrop();
    scene.add(this.backdrop);

    this.surface = this.createSurface();
    scene.add(this.surface);
  }

  /**
   * The open water, as a gradient rather than a single flat colour.
   *
   * `scene.background` can only be one colour, and fog fades everything toward
   * one colour, so with nothing else the whole view outside the geometry is a
   * single tint — the ceiling above and the emptiness ahead are literally the
   * same pixels, and the horizon has no position. This is a large sphere
   * carrying a vertical ramp that passes exactly through the fog colour at eye
   * level, so distant geometry still dissolves into it seamlessly while up and
   * down visibly depart from it.
   */
  private createBackdrop(): THREE.Mesh {
    // Inside the far plane, and wide enough that the camera never leaves it
    // even at full orbit distance.
    const geometry = new THREE.SphereGeometry(320, 24, 16);

    const material = new THREE.ShaderMaterial({
      uniforms: this.backdropUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      // Fogging the thing the fog fades into would only wash the ramp flat.
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize( position );
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon;
        uniform vec3 uAbove;
        uniform vec3 uBelow;
        varying vec3 vDir;

        void main() {
          float h = normalize( vDir ).y;
          // Both ramps count upward from the horizon. GLSL's smoothstep is
          // undefined when edge0 exceeds edge1, so descending from zero has to
          // be written as ascending in -h — expressed the other way round it
          // snaps to its end colour at once and draws a hard line across the
          // view, which is the opposite of the point.
          vec3 color = h > 0.0
            ? mix( uHorizon, uAbove, smoothstep( 0.0, 0.72, h ) )
            : mix( uHorizon, uBelow, smoothstep( 0.0, 0.6, -h ) );
          gl_FragColor = vec4( color, 1.0 );
          #include <colorspace_fragment>
        }
      `,
    });

    const mesh = new THREE.Mesh(geometry, material);
    // Behind everything, including the surface plane.
    mesh.renderOrder = -2;
    mesh.frustumCulled = false;
    return mesh;
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

    // The horizon matches the fog exactly, so distance dissolves into it with
    // no seam; the ramp then pulls away from that in both directions, which is
    // what actually gives the horizon a position.
    this.backdropUniforms.uHorizon.value.copy(this.tint);
    this.backdropUniforms.uAbove.value
      .copy(this.tint)
      .lerp(this.surfaceLight, WATER.horizonLift * (1 - eased * 0.45));
    this.backdropUniforms.uBelow.value
      .copy(this.tint)
      .lerp(this.abyss, WATER.horizonSink);

    // The mirrored half of the ceiling shows the water under it, so it has to
    // track the same tint or it reads as a painted lid.
    this.surfaceUniforms.uMirror.value.copy(this.tint).lerp(this.abyss, 0.22);

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

    // The backdrop travels in all three axes: it stands in for distance in
    // every direction, so the swimmer must stay at its centre.
    this.backdrop.position.copy(swimmerPosition);
  }

  private createSurface(): THREE.Mesh {
    // Sized to comfortably exceed the fog distance in every direction.
    const geometry = new THREE.PlaneGeometry(900, 900, 1, 1);
    geometry.rotateX(Math.PI / 2);

    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      // Seen only from below; culling the top face avoids drawing it twice
      // when the camera orbits above the swimmer near the surface.
      side: THREE.BackSide,
      depthWrite: false,
    });

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uSurfaceTime = this.surfaceUniforms.uSurfaceTime;
      shader.uniforms.uGlow = this.surfaceUniforms.uGlow;
      shader.uniforms.uMirror = this.surfaceUniforms.uMirror;

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
           uniform vec3 uGlow;
           uniform vec3 uMirror;
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

             // How far this patch of ceiling sits from straight overhead.
             // Inside the critical angle it is a window onto the sky; outside
             // it, the water total-internally reflects and the ceiling turns
             // into a mirror of the depths. The ripple is applied to the angle
             // rather than to the colour, so the edge of the window breaks up
             // into moving scallops the way it actually does.
             vec3 toSurface = normalize( vSurfWorld - cameraPosition );
             float vertical = abs( toSurface.y ) + ( ripple - 0.55 ) * 0.12;
             float window = smoothstep( ${SURFACE_CRITICAL} - 0.2, ${SURFACE_CRITICAL} + 0.26, vertical );

             vec3 ceiling = mix( uMirror, uGlow, window );
             ceiling *= 0.82 + ripple * 0.42;
             gl_FragColor.rgb = ceiling;
             // The window is nearly opaque; the mirrored part is thin enough to
             // let the fog and whatever is beyond show through it.
             gl_FragColor.a = mix( 0.34, 0.95, window );

             // Dissolve with distance rather than ending.
             //
             // The ceiling is a finite plane, and any plane that simply stops
             // draws a hard line across the view where it does — here the far
             // clip plane cuts it long before its own edge, and the graded
             // water showing past the cut is not the colour the fog has faded
             // the ceiling to, so the two do not meet. Fading it out well
             // inside the clip distance means there is no edge to see, and it
             // is what the surface does anyway: overhead it is a bright lid,
             // and toward the horizon it is lost in the murk.
             float toCamera = length( vSurfWorld - cameraPosition );
             gl_FragColor.a *= 1.0 - smoothstep( ${SURFACE_FADE_NEAR}, ${SURFACE_FADE_FAR}, toCamera );
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
