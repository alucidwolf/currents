import * as THREE from "three";

/**
 * Swimming animation with no skeleton.
 *
 * Rigging four creatures would mean bones, weights, skinned meshes and an
 * animation system. Instead a travelling sine wave is injected into the vertex
 * stage and the whole body flexes on the GPU for the cost of two uniforms.
 *
 * The wave is weighted so the nose barely moves and the tail moves most, which
 * is the single detail that separates "swimming" from "wobbling".
 *
 * Vertex normals are deliberately not recomputed for the deformation. At these
 * amplitudes, under flat shading, seen through fog, the lighting error is not
 * perceptible — and skipping it keeps this to a handful of instructions.
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

export function createSwimMaterial(options: SwimMaterialOptions): SwimMaterial {
  const material = new THREE.MeshLambertMaterial({
    color: options.color,
    flatShading: options.flatShading ?? true,
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

  const body = deformationFor(options.mode);
  const cacheKey = `currents-swim-${options.mode}-${cacheKeyCounter++}`;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uSwimTime;
         uniform float uSwimAmp;
         uniform float uSwimWave;
         uniform float uSwimSpeed;
         uniform float uSwimNose;
         uniform float uSwimLength;
         uniform float uSwimOnset;
         uniform float uSwimSpan;`,
      )
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${body}`);
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

function deformationFor(mode: SwimMode): string {
  if (mode === "wing") {
    // Rays ripple outward along the span rather than back along the body.
    return /* glsl */ `
      {
        float spanT = clamp( abs( transformed.x ) / max( uSwimSpan, 0.0001 ), 0.0, 1.0 );
        float w = pow( spanT, 1.45 );
        float phase = abs( transformed.x ) * uSwimWave - uSwimTime * uSwimSpeed;
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
      float bodyT = clamp( ( uSwimNose - transformed.z ) / max( uSwimLength, 0.0001 ), 0.0, 1.0 );
      float w = smoothstep( uSwimOnset, 1.0, bodyT );
      float phase = transformed.z * uSwimWave + uSwimTime * uSwimSpeed;
      transformed.${axis} += sin( phase ) * uSwimAmp * w;
    }
  `;
}
