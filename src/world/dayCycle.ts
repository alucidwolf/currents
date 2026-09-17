import * as THREE from "three";
import { DAY } from "../core/config";
import type { DayKey } from "../core/config";

/**
 * The time of day, and the light that goes with it.
 *
 * A day is a phase from 0 to 1 that wraps: 0 is midnight, 0.25 sunrise, 0.5
 * noon, 0.75 sunset. The light at any phase is an eased blend of the two keys
 * either side of it in `DAY.keys`, so the look is data and this file is only
 * arithmetic.
 *
 * Everything that lights the water reads from one sample of this, once a
 * frame. That is what keeps them agreeing — the fog and the backdrop horizon
 * especially, which must stay the same colour at every moment or the edge of
 * the world shows.
 */

/** One moment's light, with colours ready to hand to Three. */
export interface DayLight {
  phase: number;
  shallow: THREE.Color;
  deep: THREE.Color;
  surfaceGlow: THREE.Color;
  sunColor: THREE.Color;
  sun: number;
  ambient: number;
  fill: number;
  shaftColor: THREE.Color;
  shafts: number;
  causticColor: THREE.Color;
  caustics: number;
  warmth: number;
  glow: number;
}

export function createDayLight(): DayLight {
  return {
    phase: 0,
    shallow: new THREE.Color(),
    deep: new THREE.Color(),
    surfaceGlow: new THREE.Color(),
    sunColor: new THREE.Color(),
    sun: 0,
    ambient: 0,
    fill: 0,
    shaftColor: new THREE.Color(),
    shafts: 0,
    causticColor: new THREE.Color(),
    caustics: 0,
    warmth: 0,
    glow: 0,
  };
}

/** Wrap any number into [0, 1). */
export function wrapPhase(phase: number): number {
  return ((phase % 1) + 1) % 1;
}

const scratchA = new THREE.Color();
const scratchB = new THREE.Color();

/**
 * The light at a phase, written into `out` without allocating.
 *
 * Colours blend in linear space, which is what `THREE.Color` holds, so a
 * sunset fades through real in-between colours rather than the muddy greys an
 * sRGB blend passes through.
 */
export function sampleDay(
  phase: number,
  out: DayLight = createDayLight(),
  keys: readonly DayKey[] = DAY.keys,
): DayLight {
  const p = wrapPhase(phase);

  // The key at or before p, and the one after it, wrapping round midnight.
  let index = keys.length - 1;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i]!.phase <= p) index = i;
  }
  const a = keys[index]!;
  const b = keys[(index + 1) % keys.length]!;

  let span = b.phase - a.phase;
  let into = p - a.phase;
  if (span <= 0) span += 1;
  if (into < 0) into += 1;
  const raw = span > 0 ? Math.min(1, into / span) : 0;
  // Smoothstep, so the rate of change is zero at every key and no key is a
  // visible corner in the day.
  const t = raw * raw * (3 - 2 * raw);

  const mixColor = (target: THREE.Color, from: number, to: number) =>
    target.copy(scratchA.set(from)).lerp(scratchB.set(to), t);
  const mix = (from: number, to: number) => from + (to - from) * t;

  out.phase = p;
  mixColor(out.shallow, a.shallow, b.shallow);
  mixColor(out.deep, a.deep, b.deep);
  mixColor(out.surfaceGlow, a.surfaceGlow, b.surfaceGlow);
  mixColor(out.sunColor, a.sunColor, b.sunColor);
  mixColor(out.shaftColor, a.shaftColor, b.shaftColor);
  mixColor(out.causticColor, a.causticColor, b.causticColor);
  out.sun = mix(a.sun, b.sun);
  out.ambient = mix(a.ambient, b.ambient);
  out.fill = mix(a.fill, b.fill);
  out.shafts = mix(a.shafts, b.shafts);
  out.caustics = mix(a.caustics, b.caustics);
  out.warmth = mix(a.warmth, b.warmth);
  out.glow = mix(a.glow, b.glow);
  return out;
}

/**
 * Where the sun sits relative to the animal at a phase.
 *
 * East at sunrise, overhead at noon, west at sunset, and round again for the
 * moon. Only the east–west offset moves; the height stays put, because
 * underwater the light has already been bent toward vertical by the surface
 * and never comes in truly low.
 */
export function sunOffset(phase: number, out = new THREE.Vector3()): THREE.Vector3 {
  const [x, y, z] = DAY.sunOffset;
  const swing = Math.cos((wrapPhase(phase) - 0.25) * Math.PI * 2) * DAY.sunSwing;
  return out.set(x + swing, y, z);
}

/** A phase as a 24-hour clock, for the stats overlay. */
export function formatPhase(phase: number): string {
  const minutes = Math.floor(wrapPhase(phase) * 24 * 60);
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * The time of day a link asks for, as a phase.
 *
 * `#time=dusk` names a moment; `#time=18.5` is an hour on a 24-hour clock.
 * Anything else is ignored.
 */
export function phaseFromHash(hash: string = location.hash): number | null {
  const match = /(?:^|[#&])time=([a-z0-9.]+)/i.exec(hash);
  if (!match) return null;

  const named: Record<string, number> = {
    night: 0,
    dawn: 0.235,
    sunrise: 0.27,
    morning: 0.36,
    noon: 0.5,
    sunset: 0.73,
    dusk: 0.79,
  };
  const word = match[1]!.toLowerCase();
  if (word in named) return named[word]!;

  const hours = Number.parseFloat(word);
  return Number.isFinite(hours) && hours >= 0 && hours <= 24 ? wrapPhase(hours / 24) : null;
}

/** The running clock. */
export class DayClock {
  private current: number;
  readonly light = createDayLight();

  constructor(phase: number) {
    this.current = wrapPhase(phase);
    sampleDay(this.current, this.light);
  }

  get phase(): number {
    return this.current;
  }

  set phase(value: number) {
    this.current = wrapPhase(value);
    sampleDay(this.current, this.light);
  }

  update(dt: number): DayLight {
    this.current = wrapPhase(this.current + dt / DAY.length);
    return sampleDay(this.current, this.light);
  }
}
