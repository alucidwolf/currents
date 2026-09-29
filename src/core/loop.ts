import { RENDER } from "./config";

export type FrameFn = (dt: number, elapsed: number) => void;

export interface Loop {
  start(): void;
  stop(): void;
  /**
   * Freeze the world on purpose, or let it go again.
   *
   * Kept apart from the tab-hidden suspend below, because the two mean
   * different things and must not cancel each other: a paused page that is
   * tabbed away from and come back to is still paused.
   */
  setPaused(paused: boolean): void;
  /** True only when the player stopped it, never when the tab is merely hidden. */
  readonly paused: boolean;
  /**
   * Draw one frame without advancing time.
   *
   * A paused page is not running, so nothing redraws — and a canvas that is not
   * redrawn is stretched by a window resize until something else happens to
   * paint it. One still frame puts the picture back without the world moving.
   */
  renderStill(): void;
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
 *
 * On top of those, the player can pause. Two separate reasons to stop, tracked
 * separately and combined on demand: an earlier version folded them into one
 * `running` flag, and a pause followed by a tab switch and a switch back came
 * out running again, because the visibility handler could see only that the
 * loop was stopped and not why.
 */
export function createLoop(frame: FrameFn): Loop {
  let running = false;
  let handle = 0;
  let last = 0;
  let elapsed = 0;
  let fps = 0;
  /** Stopped on purpose by the player. */
  let userPaused = false;
  /** Stopped because nobody can see it. */
  let hidden = false;
  /** Set once `start` has been called, so nothing runs before or after it. */
  let live = false;

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
    hidden = document.hidden;
    sync();
  };

  /** Run only when nothing is asking us not to. */
  function sync() {
    const shouldRun = live && !userPaused && !hidden;
    if (shouldRun === running) return;
    if (shouldRun) resume();
    else halt();
  }

  function resume() {
    running = true;
    last = performance.now();
    handle = requestAnimationFrame(tick);
  }

  function halt() {
    running = false;
    if (handle) cancelAnimationFrame(handle);
    handle = 0;
  }

  return {
    start() {
      document.addEventListener("visibilitychange", onVisibility);
      live = true;
      hidden = document.hidden;
      sync();
    },
    stop() {
      document.removeEventListener("visibilitychange", onVisibility);
      live = false;
      sync();
    },
    setPaused(paused: boolean) {
      if (paused === userPaused) return;
      userPaused = paused;
      sync();
    },
    get paused() {
      return userPaused;
    },
    renderStill() {
      // Zero delta on purpose: every system takes `dt` as how far to advance,
      // so nothing moves, and the two places that divide by it already guard
      // against zero. `elapsed` is passed unchanged, so anything driven by
      // absolute time — the swimmer's stroke, the caustics — holds its pose
      // rather than snapping back to the start of its cycle.
      frame(0, elapsed);
    },
    get elapsed() {
      return elapsed;
    },
    get fps() {
      return fps;
    },
  };
}
