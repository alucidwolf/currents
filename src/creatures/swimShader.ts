import * as THREE from "three";

/**
 * Swimming animation with no skeleton.
 *
 * Rigging four creatures would mean bones, weights, skinned meshes and an
 * animation system. Instead a travelling sine wave is injected into the vertex
 * stage and the whole body flexes on the GPU for the cost of a few uniforms.
 *
 * The wave is weighted so the nose barely moves and the tail moves most, which
 * is the single detail that separates "swimming" from "wobbling".
 *
 * Normals are corrected analytically to match the bend. Under flat shading this
 * did not matter — face normals come from screen-space derivatives of the
 * already-displaced positions — but smooth shading reads the vertex normal
 * directly, and an uncorrected one makes a flexing body look as though the
 * light is sliding across a rigid object.
 */
export type SwimMode = "vertical" | "lateral" | "wing";

export interface SwimMaterialOptions {
  color: number;
  /** Displacement in world units at the tail, or at the wingtips. */
  amplitude: number;
  /** Spatial frequency of the travelling wave. */
  wavelength: number;
  /** Beats per second. */
  speed: number;
  mode: SwimMode;
  /** Nose position in local Z, and total length, used to weight the wave. */
  nose: number;
  length: number;
  /** Fraction along the body before which nothing moves. */
  onset?: number;
  /** Half-span, for wing mode only. */
  span?: number;
  flatShading?: boolean;
  /** Read a baked colour attribute, for countershaded bodies. */
  vertexColors?: boolean;
}

export interface SwimMaterial {
  material: THREE.MeshLambertMaterial;
  setTime(t: number): void;
  /** Scales the beat with cruise speed, so slowing down looks like slowing down. */
  setRate(rate: number): void;
}

let cacheKeyCounter = 0;

const UNIFORM_DECL = /* glsl */ `
  uniform float uSwimTime;
  uniform float uSwimAmp;
  uniform float uSwimWave;
  uniform float uSwimSpeed;
  uniform float uSwimNose;
  uniform float uSwimLength;
  uniform float uSwimOnset;
  uniform float uSwimSpan;
`;

export function createSwimMaterial(options: SwimMaterialOptions): SwimMaterial {
  const material = new THREE.MeshLambertMaterial({
    color: options.color,
    // Smooth by default now: the bodies carry enough segments that faceting
    // reads as cheapness rather than style.
    flatShading: options.flatShading ?? false,
    vertexColors: options.vertexColors ?? false,
  });

  const uniforms = {
    uSwimTime: { value: 0 },
    uSwimAmp: { value: options.amplitude },
    uSwimWave: { value: options.wavelength },
    uSwimSpeed: { value: options.speed },
    uSwimNose: { value: options.nose },
    uSwimLength: { value: options.length },
    uSwimOnset: { value: options.onset ?? 0.15 },
    uSwimSpan: { value: options.span ?? 1 },
  };

  const cacheKey = `currents-swim-${options.mode}-${cacheKeyCounter++}`;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${UNIFORM_DECL}`)
      // Normals must be fixed up before Three transforms them, which happens
      // between these two chunks — hence two separate injections rather than
      // doing everything in one place.
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>\n${normalCorrectionFor(options.mode)}`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n${deformationFor(options.mode)}`,
      );
  };

  material.customProgramCacheKey = () => cacheKey;

  return {
    material,
    setTime(t: number) {
      uniforms.uSwimTime.value = t;
    },
    setRate(rate: number) {
      uniforms.uSwimSpeed.value = options.speed * rate;
    },
  };
}

/** Weight and phase, shared by the position and normal passes. */
function bodyTerms(): string {
  return /* glsl */ `
    float bodyT = clamp( ( uSwimNose - position.z ) / max( uSwimLength, 0.0001 ), 0.0, 1.0 );
    float w = smoothstep( uSwimOnset, 1.0, bodyT );
    float phase = position.z * uSwimWave + uSwimTime * uSwimSpeed;
  `;
}

function wingTerms(): string {
  return /* glsl */ `
    float spanT = clamp( abs( position.x ) / max( uSwimSpan, 0.0001 ), 0.0, 1.0 );
    float w = pow( spanT, 1.45 );
    float phase = abs( position.x ) * uSwimWave - uSwimTime * uSwimSpeed;
  `;
}

function deformationFor(mode: SwimMode): string {
  if (mode === "wing") {
    return /* glsl */ `
      {
        ${wingTerms()}
        transformed.y += sin( phase ) * uSwimAmp * w;
        // A touch of forward-back sweep stops the wings looking like they are
        // flapping in place.
        transformed.z += cos( phase ) * uSwimAmp * w * 0.18;
      }
    `;
  }

  const axis = mode === "vertical" ? "y" : "x";
  return /* glsl */ `
    {
      ${bodyTerms()}
      transformed.${axis} += sin( phase ) * uSwimAmp * w;
    }
  `;
}

/**
 * Rotate the vertex normal to match the local slope the bend introduces.
 *
 * For a displacement d(u) along one axis, the surface tangent tilts by
 * d'(u) and the normal rotates by the same angle in the opposite sense. Only
 * the dominant term of the derivative is used — the contribution from the
 * weighting ramp is small enough to be invisible and doubles the instruction
 * count to include.
 */
function normalCorrectionFor(mode: SwimMode): string {
  if (mode === "wing") {
    return /* glsl */ `
      {
        ${wingTerms()}
        float slope = cos( phase ) * uSwimWave * uSwimAmp * w * sign( position.x );
        float c = inversesqrt( 1.0 + slope * slope );
        float s = slope * c;
        objectNormal = normalize( vec3(
          objectNormal.x * c - objectNormal.y * s,
          objectNormal.x * s + objectNormal.y * c,
          objectNormal.z
        ) );
      }
    `;
  }

  if (mode === "vertical") {
    return /* glsl */ `
      {
        ${bodyTerms()}
        float slope = cos( phase ) * uSwimWave * uSwimAmp * w;
        float c = inversesqrt( 1.0 + slope * slope );
        objectNormal = normalize( vec3(
          objectNormal.x,
          objectNormal.y * c + objectNormal.z * slope * c,
          -objectNormal.y * slope * c + objectNormal.z * c
        ) );
      }
    `;
  }

  return /* glsl */ `
    {
      ${bodyTerms()}
      float slope = cos( phase ) * uSwimWave * uSwimAmp * w;
      float c = inversesqrt( 1.0 + slope * slope );
      objectNormal = normalize( vec3(
        objectNormal.x * c + objectNormal.z * slope * c,
        objectNormal.y,
        -objectNormal.x * slope * c + objectNormal.z * c
      ) );
    }
  `;
}
