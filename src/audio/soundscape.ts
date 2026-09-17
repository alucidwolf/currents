/**
 * The sound of the water, all of it synthesised.
 *
 * There are no audio files. Everything is built from two noise buffers and a
 * handful of oscillators, the same way the world is built from a seed:
 *
 *  - a **deep hum**, low noise that darkens as the animal goes deeper and swells
 *    very slowly, like a long wave passing overhead;
 *  - a **surface wash**, a brighter hiss that only comes in near the surface;
 *  - a **glide**, the water moving past the body, which rises with speed and
 *    with how hard the animal is turning;
 *  - **bubbles** now and then, in small clusters;
 *  - and rarely, a long low **call** from somewhere out in the fog.
 *
 * Everything passes through one low-pass filter on the way out. Water takes the
 * top off every sound in it, and that single filter does more to put the
 * listener underwater than any of the layers does on its own.
 *
 * Browsers only allow audio after the page has been touched, so nothing is
 * built until `start` is called from a real input event. Until then this is a
 * few numbers and no audio context at all.
 */

import { WORLD } from "../core/config";

export interface SoundFrame {
  /** Metres below the surface. */
  depth: number;
  /** Current speed relative to cruise: 1 is cruising. */
  speedRatio: number;
  /** Absolute turn rate, radians per second. */
  turnRate: number;
}

/** Seconds the whole mix takes to fade in once sound starts. */
const FADE_IN = 4;
/** A major pentatonic from C4, the one scale where no two notes argue. */
const PENTATONIC = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];

export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private deepFilter: BiquadFilterNode | null = null;
  private deepGain: GainNode | null = null;
  private washGain: GainNode | null = null;
  private glideFilter: BiquadFilterNode | null = null;
  private glideGain: GainNode | null = null;
  /** Echo send for the rare sounds, so they arrive from far away. */
  private echo: DelayNode | null = null;
  private bus: AudioNode | null = null;

  private started = false;
  private unavailable = false;
  private clock = 0;
  private nextBubbles = 6;
  private nextCall = 45;

  constructor(
    private isMuted: boolean,
    private level: number,
  ) {}

  get muted(): boolean {
    return this.isMuted;
  }

  get volume(): number {
    return this.level;
  }

  /** True once the browser has refused to make sound at all. */
  get isUnavailable(): boolean {
    return this.unavailable;
  }

  /** Build the graph. Must be called from inside a user input event. */
  start(): void {
    if (this.started) return;
    this.started = true;

    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) {
      this.unavailable = true;
      return;
    }

    let ctx: AudioContext;
    try {
      ctx = new Context();
    } catch {
      this.unavailable = true;
      return;
    }
    this.ctx = ctx;
    ctx.resume().catch(() => {});

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    master.gain.linearRampToValueAtTime(this.targetLevel(), ctx.currentTime + FADE_IN);
    this.master = master;

    const underwater = ctx.createBiquadFilter();
    underwater.type = "lowpass";
    underwater.frequency.value = 1600;
    underwater.Q.value = 0.5;
    underwater.connect(master);
    this.bus = underwater;

    const brown = brownNoise(ctx, 6);
    const pink = pinkNoise(ctx, 5);

    // Deep hum.
    this.deepFilter = ctx.createBiquadFilter();
    this.deepFilter.type = "lowpass";
    this.deepFilter.frequency.value = 300;
    this.deepFilter.Q.value = 0.7;
    this.deepGain = ctx.createGain();
    this.deepGain.gain.value = 0.55;
    loop(ctx, brown, 1).connect(this.deepFilter).connect(this.deepGain).connect(underwater);

    // Surface wash. Read at a different rate from the glide so the two layers
    // never line up into an audible repeat of the same buffer.
    const washFilter = ctx.createBiquadFilter();
    washFilter.type = "bandpass";
    washFilter.frequency.value = 900;
    washFilter.Q.value = 0.6;
    this.washGain = ctx.createGain();
    this.washGain.gain.value = 0;
    loop(ctx, pink, 0.83).connect(washFilter).connect(this.washGain).connect(underwater);

    // Glide.
    this.glideFilter = ctx.createBiquadFilter();
    this.glideFilter.type = "bandpass";
    this.glideFilter.frequency.value = 380;
    this.glideFilter.Q.value = 0.9;
    this.glideGain = ctx.createGain();
    this.glideGain.gain.value = 0;
    loop(ctx, pink, 1.17).connect(this.glideFilter).connect(this.glideGain).connect(underwater);

    // A dark, slowly decaying echo for the rare sounds. Each repeat is damped a
    // little more than the last, so it dies away into the water rather than
    // ringing.
    const echo = ctx.createDelay(1.5);
    echo.delayTime.value = 0.61;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.42;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 900;
    echo.connect(damp).connect(feedback).connect(echo);
    damp.connect(underwater);
    this.echo = echo;
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.applyLevel();
  }

  setVolume(volume: number): void {
    this.level = Math.min(1, Math.max(0, volume));
    this.applyLevel();
  }

  /** Stop making sound while the tab is hidden, and pick back up after. */
  setHidden(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) this.ctx.suspend().catch(() => {});
    else this.ctx.resume().catch(() => {});
  }

  /** Two soft notes, for a change of animal. */
  chime(): void {
    const ctx = this.ctx;
    if (!ctx || !this.bus || !this.echo) return;

    for (let i = 0; i < 2; i++) {
      const at = ctx.currentTime + i * (0.32 + Math.random() * 0.2);
      const pitch = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)]!;

      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, at);
      envelope.gain.exponentialRampToValueAtTime(0.07, at + 0.02);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + 3.2);
      envelope.connect(this.bus);
      envelope.connect(this.echo);

      const tone = ctx.createOscillator();
      tone.type = "sine";
      tone.frequency.value = pitch;
      tone.connect(envelope);
      tone.start(at);
      tone.stop(at + 3.3);
    }
  }

  update(dt: number, frame: SoundFrame): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    this.clock += dt;
    const now = ctx.currentTime;

    // Deeper is darker and slightly louder; the swell is a nine-second breath.
    const deepness = clamp01(frame.depth / Math.abs(WORLD.seabedY));
    const swell = 1 + Math.sin((this.clock / 9) * Math.PI * 2) * 0.14;
    this.deepFilter!.frequency.setTargetAtTime(420 - deepness * 260, now, 0.8);
    this.deepGain!.gain.setTargetAtTime((0.45 + deepness * 0.25) * swell, now, 0.8);

    // The wash is only for the top few metres.
    const nearSurface = 1 - clamp01((frame.depth - 2) / 12);
    this.washGain!.gain.setTargetAtTime(nearSurface * nearSurface * 0.2, now, 0.6);

    const turning = clamp01(frame.turnRate / 0.8);
    const motion = clamp01(frame.speedRatio) * 0.05 + turning * 0.12;
    this.glideGain!.gain.setTargetAtTime(motion, now, 0.35);
    this.glideFilter!.frequency.setTargetAtTime(340 + turning * 260, now, 0.35);

    if (this.clock >= this.nextBubbles) {
      this.bubbles();
      this.nextBubbles = this.clock + 5 + Math.random() * 10;
    }

    if (this.clock >= this.nextCall) {
      this.call();
      this.nextCall = this.clock + 75 + Math.random() * 80;
    }
  }

  dispose(): void {
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  // -- internals -------------------------------------------------------------

  private targetLevel(): number {
    return this.isMuted ? 0 : this.level;
  }

  private applyLevel(): void {
    if (!this.ctx || !this.master) return;
    // A short ramp rather than a jump, which would click.
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(this.targetLevel(), this.ctx.currentTime, 0.08);
  }

  /** A few bubbles rising: each a sine that sweeps upward as it pops. */
  private bubbles(): void {
    const ctx = this.ctx!;
    const count = 2 + Math.floor(Math.random() * 5);

    for (let i = 0; i < count; i++) {
      const at = ctx.currentTime + i * (0.05 + Math.random() * 0.16);
      const length = 0.04 + Math.random() * 0.06;
      const from = 480 + Math.random() * 900;

      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, at);
      envelope.gain.exponentialRampToValueAtTime(0.045, at + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + length);
      envelope.connect(this.bus!);

      const tone = ctx.createOscillator();
      tone.type = "sine";
      tone.frequency.setValueAtTime(from, at);
      tone.frequency.exponentialRampToValueAtTime(from * 2.3, at + length);
      tone.connect(envelope);
      tone.start(at);
      tone.stop(at + length + 0.02);
    }
  }

  /**
   * A long, low call from far away.
   *
   * A glide up and back down with a slow vibrato, and a quieter fifth above it.
   * Mostly echo: it should sound like something heard, not something nearby.
   */
  private call(): void {
    const ctx = this.ctx!;
    const at = ctx.currentTime + 0.1;
    const length = 3.2 + Math.random() * 1.6;
    const base = 130 + Math.random() * 110;

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(0.05, at + length * 0.35);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + length);

    const far = ctx.createBiquadFilter();
    far.type = "lowpass";
    far.frequency.value = 700;
    envelope.connect(far);
    far.connect(this.bus!);
    far.connect(this.echo!);

    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 4.5;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = base * 0.02;
    vibrato.connect(vibratoDepth);

    for (const [ratio, gain] of [
      [1, 1],
      [1.5, 0.28],
    ] as const) {
      const tone = ctx.createOscillator();
      tone.type = "sine";
      tone.frequency.setValueAtTime(base * ratio, at);
      tone.frequency.exponentialRampToValueAtTime(base * ratio * 1.45, at + length * 0.45);
      tone.frequency.exponentialRampToValueAtTime(base * ratio * 0.9, at + length);
      vibratoDepth.connect(tone.frequency);

      const level = ctx.createGain();
      level.gain.value = gain;
      tone.connect(level).connect(envelope);
      tone.start(at);
      tone.stop(at + length + 0.1);
    }

    vibrato.start(at);
    vibrato.stop(at + length + 0.1);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function loop(ctx: AudioContext, buffer: AudioBuffer, rate: number): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.playbackRate.value = rate;
  source.start();
  return source;
}

/**
 * A noise buffer that loops without a seam.
 *
 * Noise played on a loop jumps from its last sample to its first, and a low,
 * slow noise like the hum turns that jump into a thump every few seconds. So
 * the buffer is generated a little long, and its start is crossfaded with the
 * overhang: the last sample then leads straight into the first.
 */
function seamlessNoise(
  ctx: AudioContext,
  seconds: number,
  fill: (raw: Float32Array) => void,
): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const overlap = Math.floor(ctx.sampleRate * 0.25);
  const raw = new Float32Array(length + overlap);
  fill(raw);

  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    if (i < overlap) {
      const t = i / overlap;
      data[i] = raw[i]! * t + raw[length + i]! * (1 - t);
    } else {
      data[i] = raw[i]!;
    }
  }
  return buffer;
}

/** Pink noise (Paul Kellet's filter): even energy per octave, a soft hiss. */
function pinkNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  return seamlessNoise(ctx, seconds, (data) => {
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  });
}

/** Brown noise: integrated white noise, heavy at the bottom, a rumble. */
function brownNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  return seamlessNoise(ctx, seconds, (data) => {
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = (last + (Math.random() * 2 - 1) * 0.02) / 1.02;
      data[i] = last * 3.5;
    }
  });
}
