import { RENDER } from "./config";

export type FrameFn = (dt: number, elapsed: number) => void;

export interface Loop {
  start(): void;
  stop(): void;
  /** Seconds since start, excluding time spent with the tab hidden. */
  readonly elapsed: number;
  /** Smoothed frames per second, for the perf overlay. */
  readonly fps: number;
}

/**
 * requestAnimationFrame loop with two safeguards:
 *
 *  - `dt` is clamped, so a long stall (tab switch, GC pause, laptop sleep) can
 *    never integrate into a huge step that teleports the swimmer through the
 *    seabed on the next frame.
 *  - rendering suspends entirely while the tab is hidden. A second monitor
 *    showing the page stays visible and keeps running, which is the case we
 *    care about; a genuinely backgrounded tab stops burning battery.
 */
export function createLoop(frame: FrameFn): Loop {
  let running = false;
  let handle = 0;
  let last = 0;
  let elapsed = 0;
  let fps = 0;

  const tick = (now: number) => {
    if (!running) return;
    handle = requestAnimationFrame(tick);

    const raw = (now - last) / 1000;
    last = now;

    // First frame after start or resume: no meaningful delta yet.
    if (raw <= 0 || raw > 1e3) return;

    const dt = Math.min(raw, RENDER.maxDelta);
    elapsed += dt;

    // Exponential smoothing, so the readout does not flicker every frame.
    const instant = 1 / Math.max(raw, 1e-6);
    fps = fps === 0 ? instant : fps + (instant - fps) * 0.08;

    frame(dt, elapsed);
  };

  const onVisibility = () => {
    if (document.hidden) {
      pause();
    } else if (!running) {
      resume();
    }
  };

  function resume() {
    if (running) return;
    running = true;
    last = performance.now();
    handle = requestAnimationFrame(tick);
  }

  function pause() {
    running = false;
    if (handle) cancelAnimationFrame(handle);
    handle = 0;
  }

  return {
    start() {
      document.addEventListener("visibilitychange", onVisibility);
      resume();
    },
    stop() {
      document.removeEventListener("visibilitychange", onVisibility);
      pause();
    },
    get elapsed() {
      return elapsed;
    },
    get fps() {
      return fps;
    },
  };
}
