import * as THREE from "three";
import { WORLD } from "../core/config";

/**
 * Rippling sunlight on the seabed, injected into a stock Three material.
 *
 * Entirely procedural — no texture files, no extra draw calls, no render
 * targets. Three overlapping sine fields in world space, sharpened by a power
 * curve so the bright veins read as focused light rather than a wobble, then
 * attenuated with depth so the effect fades out down in the dark where real
 * caustics would not reach.
 *
 * Sampling in *world* space matters: the pattern is continuous across chunk
 * boundaries and stays put as chunks stream in and out, so nothing shimmers
 * when the terrain under it is recycled.
 */
export interface CausticMaterial {
  material: THREE.Material;
  setTime(t: number): void;
}

const VERTEX_DECL = /* glsl */ `
  varying vec3 vCausticWorld;
`;

const VERTEX_BODY = /* glsl */ `
  vCausticWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

const FRAGMENT_DECL = /* glsl */ `
  uniform float uCausticTime;
  uniform float uCausticStrength;
  uniform vec3 uCausticColor;
  varying vec3 vCausticWorld;

  float causticField( vec2 p, float t ) {
    vec2 a = p * 0.115;
    float v = 0.0;
    v += sin( a.x * 1.30 + t * 0.90 ) * sin( a.y * 1.10 - t * 0.70 );
    v += sin( ( a.x + a.y ) * 0.90 - t * 1.05 ) * 0.70;
    v += sin( length( a ) * 1.70 + t * 0.45 ) * 0.50;
    v = v / 2.2 * 0.5 + 0.5;
    // A slightly softer power than before: the target look is broad bright
    // ribbons rolling across the sand, not a fine sparkle.
    return pow( clamp( v, 0.0, 1.0 ), 2.8 );
  }
`;

const FRAGMENT_BODY = /* glsl */ `
  {
    float depthFade = clamp(
      ( vCausticWorld.y - ( ${WORLD.seabedY.toFixed(1)} - 24.0 ) ) / 38.0,
      0.0,
      1.0
    );
    // Two offset samples beating against each other avoids an obvious tiling
    // rhythm, which a single field develops after a minute or so of watching.
    float c = causticField( vCausticWorld.xz, uCausticTime );
    c += causticField( vCausticWorld.xz * 1.7 + 31.4, uCausticTime * 0.8 ) * 0.5;
    gl_FragColor.rgb += uCausticColor * c * uCausticStrength * depthFade;
  }
`;

export function makeCausticTerrainMaterial(): CausticMaterial {
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    // Smooth-shaded: at this chunk resolution flat shading turned every slope
    // into a visible staircase of facets. The terrain now carries its detail
    // in the geometry rather than in the lighting.
    flatShading: false,
  });

  const uniforms = {
    uCausticTime: { value: 0 },
    uCausticStrength: { value: 0.95 },
    uCausticColor: { value: new THREE.Color(0xd6f6ff) },
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCausticTime = uniforms.uCausticTime;
    shader.uniforms.uCausticStrength = uniforms.uCausticStrength;
    shader.uniforms.uCausticColor = uniforms.uCausticColor;

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_DECL}`)
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>\n${VERTEX_BODY}`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_DECL}`)
      .replace(
        "#include <opaque_fragment>",
        `#include <opaque_fragment>\n${FRAGMENT_BODY}`,
      );
  };

  // Materials with an onBeforeCompile hook need a stable cache key, or Three
  // recompiles the program on every frame that touches the material.
  material.customProgramCacheKey = () => "currents-caustic-terrain";

  return {
    material,
    setTime(t: number) {
      uniforms.uCausticTime.value = t;
    },
  };
}
