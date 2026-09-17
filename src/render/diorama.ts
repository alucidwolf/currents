import * as THREE from "three";
import { DIORAMA } from "../core/config";

/**
 * The diorama pass: depth of field, a split-tone grade, and a vignette.
 *
 * This is the whole difference between "a low-poly scene" and the cosy tabletop
 * look. Chunky simple forms under soft light read as a *model* of a world
 * rather than a world, and what sells that reading is a shallow depth of field
 * — the same trick that makes a tilt-shift photograph of a real street look
 * like a toy. Everything else here is already in the right register; this is
 * what tells the eye how big to think the scene is.
 *
 * Focus follows the animal rather than a fixed plane. That keeps the subject
 * crisp wherever the camera happens to be orbiting, and softens the water in
 * front of it and the reef behind — which is also the honest thing to do
 * underwater, where scattering genuinely does soften distance.
 *
 * Three passes, and the expensive one runs at half resolution:
 *
 *   1. the scene, into a target that keeps its depth
 *   2. a separable blur of that colour at half res, two draws
 *   3. a composite that mixes sharp and soft by circle of confusion, then
 *      grades and vignettes on the way to the screen
 *
 * Written by hand rather than assembled from the stock post-processing stack:
 * the whole chain is one blur and one composite, and owning the shaders means
 * the grade rides along in a pass that was already happening.
 */

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

/**
 * Nine-tap separable Gaussian.
 *
 * Run on a half-resolution copy, so its effective reach on screen is twice what
 * the tap offsets suggest and the cost is a quarter of what it looks like.
 */
const BLUR = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uDirection;
varying vec2 vUv;

void main() {
  vec4 sum = texture2D( tDiffuse, vUv ) * 0.227027;
  sum += ( texture2D( tDiffuse, vUv + uDirection * 1.3846 )
         + texture2D( tDiffuse, vUv - uDirection * 1.3846 ) ) * 0.316216;
  sum += ( texture2D( tDiffuse, vUv + uDirection * 3.2308 )
         + texture2D( tDiffuse, vUv - uDirection * 3.2308 ) ) * 0.070270;
  gl_FragColor = sum;
}
`;

const COMPOSITE = /* glsl */ `
uniform sampler2D tSharp;
uniform sampler2D tSoft;
uniform sampler2D tDepth;

uniform float uNear;
uniform float uFar;
uniform float uFocus;
uniform float uFocusRange;
uniform float uNearFalloff;
uniform float uFarFalloff;
uniform float uMaxNear;
uniform float uMaxFar;

uniform vec3 uWarm;
uniform vec3 uCool;
uniform float uSaturation;
uniform float uVignette;

varying vec2 vUv;

/** Depth buffers are non-linear; distance in metres is what focus wants. */
float eyeDepth( vec2 uv ) {
  float z = texture2D( tDepth, uv ).x;
  float ndc = z * 2.0 - 1.0;
  return ( 2.0 * uNear * uFar ) / ( uFar + uNear - ndc * ( uFar - uNear ) );
}

void main() {
  vec4 sharp = texture2D( tSharp, vUv );
  vec4 soft = texture2D( tSoft, vUv );

  float depth = eyeDepth( vUv );
  float signedDistance = depth - uFocus;

  // Near and far are deliberately asymmetric. Foreground water should go soft
  // quickly — that near blur is most of the toy-model effect — while distance
  // is capped well short of a smear, because the reef back there is scenery
  // worth being able to read.
  float coc;
  if ( signedDistance < 0.0 ) {
    coc = clamp( ( -signedDistance - uFocusRange ) / uNearFalloff, 0.0, 1.0 ) * uMaxNear;
  } else {
    coc = clamp( ( signedDistance - uFocusRange ) / uFarFalloff, 0.0, 1.0 ) * uMaxFar;
  }

  vec3 color = mix( sharp.rgb, soft.rgb, coc );

  // Split tone: warm the light, cool the dark. Doing this as a grade rather
  // than with a warm key light is deliberate — a warm lamp against this
  // scene's cool ambient averages to grey on every surface, which is how the
  // palette went muddy once already. After lighting, the two pull apart
  // instead of cancelling.
  float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  color += uWarm * smoothstep( 0.42, 1.0, luma );
  color += uCool * ( 1.0 - smoothstep( 0.0, 0.58, luma ) );

  color = mix( vec3( luma ), color, uSaturation );

  // Corners fall off, which frames the scene as an object being looked at.
  float edge = length( ( vUv - 0.5 ) * vec2( 1.0, 0.86 ) );
  color *= mix( 1.0, 1.0 - uVignette, smoothstep( 0.34, 0.78, edge ) );

  gl_FragColor = vec4( color, 1.0 );

  // Everything above happens in linear light, which is the only space in which
  // blurring and grading are meaningful. The scene materials wrote linear into
  // the render target because that is what its texture asks for, so this pass
  // owns the conversion on the way to the screen — the step the built-in
  // materials would normally have done. Without it the whole image reads as
  // though the lights had been turned down.
  #include <colorspace_fragment>
}
`;

function fullscreenTriangle(): THREE.BufferGeometry {
  // One oversized triangle rather than two: no seam down the diagonal, and
  // every pixel is shaded exactly once.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return geometry;
}

export class Diorama {
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.Camera();

  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;

  private sceneTarget: THREE.WebGLRenderTarget;
  private blurA: THREE.WebGLRenderTarget;
  private blurB: THREE.WebGLRenderTarget;

  private width = 1;
  private height = 1;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.blurMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: BLUR,
      uniforms: {
        tDiffuse: { value: null },
        uDirection: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: COMPOSITE,
      uniforms: {
        tSharp: { value: null },
        tSoft: { value: null },
        tDepth: { value: null },
        uNear: { value: 0.1 },
        uFar: { value: 100 },
        uFocus: { value: 20 },
        uFocusRange: { value: DIORAMA.focusRange },
        uNearFalloff: { value: DIORAMA.nearFalloff },
        uFarFalloff: { value: DIORAMA.farFalloff },
        uMaxNear: { value: DIORAMA.maxNearBlur },
        uMaxFar: { value: DIORAMA.maxFarBlur },
        uWarm: { value: new THREE.Vector3(...DIORAMA.warmHighlights) },
        uCool: { value: new THREE.Vector3(...DIORAMA.coolShadows) },
        uSaturation: { value: DIORAMA.saturation },
        uVignette: { value: DIORAMA.vignette },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.quad = new THREE.Mesh(fullscreenTriangle(), this.blurMaterial);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.sceneTarget = this.createSceneTarget(1, 1);
    this.blurA = this.createBlurTarget(1, 1);
    this.blurB = this.createBlurTarget(1, 1);
  }

  private createSceneTarget(width: number, height: number): THREE.WebGLRenderTarget {
    const depthTexture = new THREE.DepthTexture(width, height);
    depthTexture.type = THREE.UnsignedIntType;

    return new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthTexture,
      depthBuffer: true,
      // Multisampled: the canvas's own antialiasing does nothing once the scene
      // is drawn into a target instead, and the in-focus subject is precisely
      // where jagged edges would be most obvious.
      samples: 4,
    });
  }

  private createBlurTarget(width: number, height: number): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, Math.floor(width * pixelRatio));
    this.height = Math.max(1, Math.floor(height * pixelRatio));

    this.sceneTarget.setSize(this.width, this.height);
    const halfWidth = Math.max(1, Math.floor(this.width / 2));
    const halfHeight = Math.max(1, Math.floor(this.height / 2));
    this.blurA.setSize(halfWidth, halfHeight);
    this.blurB.setSize(halfWidth, halfHeight);
  }

  /**
   * Scale the warm highlights for the time of day.
   *
   * 1 is the approved grade. Sunrise and sunset push past it, and night takes
   * it away entirely — warm highlights on moonlit water would read as a lamp.
   */
  setWarmth(scale: number): void {
    const [r, g, b] = DIORAMA.warmHighlights;
    (this.compositeMaterial.uniforms.uWarm!.value as THREE.Vector3).set(
      r * scale,
      g * scale,
      b * scale,
    );
  }

  /** `focusDistance` is how far the subject is from the camera, in metres. */
  render(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    focusDistance: number,
  ): void {
    const renderer = this.renderer;

    renderer.setRenderTarget(this.sceneTarget);
    renderer.clear();
    renderer.render(scene, camera);

    // --- blur, at half resolution -------------------------------------------
    const halfWidth = this.blurA.width;
    const halfHeight = this.blurA.height;
    const reach = DIORAMA.blurRadius;

    this.quad.material = this.blurMaterial;

    this.blurMaterial.uniforms.tDiffuse!.value = this.sceneTarget.texture;
    this.blurMaterial.uniforms.uDirection!.value.set(reach / halfWidth, 0);
    renderer.setRenderTarget(this.blurA);
    renderer.render(this.quadScene, this.quadCamera);

    this.blurMaterial.uniforms.tDiffuse!.value = this.blurA.texture;
    this.blurMaterial.uniforms.uDirection!.value.set(0, reach / halfHeight);
    renderer.setRenderTarget(this.blurB);
    renderer.render(this.quadScene, this.quadCamera);

    // --- composite to the screen --------------------------------------------
    const uniforms = this.compositeMaterial.uniforms;
    uniforms.tSharp!.value = this.sceneTarget.texture;
    uniforms.tSoft!.value = this.blurB.texture;
    uniforms.tDepth!.value = this.sceneTarget.depthTexture;
    uniforms.uNear!.value = camera.near;
    uniforms.uFar!.value = camera.far;
    uniforms.uFocus!.value = focusDistance;

    this.quad.material = this.compositeMaterial;
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.sceneTarget.dispose();
    this.sceneTarget.depthTexture?.dispose();
    this.blurA.dispose();
    this.blurB.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
    this.quad.geometry.dispose();
  }
}
