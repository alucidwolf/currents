/**
 * Headless check that a pause stays a pause.
 *
 * There are two independent reasons the loop stops — the player asked, or nobody
 * can see the page — and the whole difficulty is that they overlap. The failure
 * this exists to catch is the obvious implementation: one `running` flag, and a
 * visibility handler that resumes whenever it finds the loop stopped. That
 * version passes every simple test and then starts the world up again the moment
 * a paused tab is switched away from and come back to, because by then nothing
 * records that the stop was deliberate.
 *
 * So every order of the two is tried here, and after each one the question is
 * the same: is a frame being asked for, and should it be?
 *
 * Run with:  npm run verify:pause
 */

import { createLoop } from "../src/core/loop";

// -- a fake browser ----------------------------------------------------------

/**
 * Enough of `requestAnimationFrame` to count.
 *
 * Frames are never delivered on their own: each one is handed over by `deliver`
 * below, so a test says exactly when time passes. What matters is whether a
 * frame is *outstanding* — that is what "the loop is running" means.
 */
let pending: ((now: number) => void) | null = null;
let nextHandle = 1;
let clock = 0;

const listeners = new Map<string, Set<() => void>>();
let hiddenFlag = false;

const fakeDocument = {
  get hidden() {
    return hiddenFlag;
  },
  addEventListener(type: string, fn: () => void) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  },
  removeEventListener(type: string, fn: () => void) {
    listeners.get(type)?.delete(fn);
  },
};

const globals = globalThis as unknown as Record<string, unknown>;
globals.document = fakeDocument;
globals.performance = { now: () => clock };
globals.requestAnimationFrame = (fn: (now: number) => void) => {
  pending = fn;
  return nextHandle++;
};
globals.cancelAnimationFrame = () => {
  pending = null;
};

/** Is a frame outstanding? */
function running(): boolean {
  return pending !== null;
}

/** Hand over one frame, `ms` later. */
function deliver(ms = 16): void {
  const fn = pending;
  if (!fn) return;
  pending = null;
  clock += ms;
  fn(clock);
}

function setHidden(hidden: boolean): void {
  hiddenFlag = hidden;
  for (const fn of listeners.get("visibilitychange") ?? []) fn();
}

// -- the checks --------------------------------------------------------------

const failures: string[] = [];
let passed = 0;
function check(condition: boolean, name: string): void {
  if (condition) passed++;
  else failures.push(name);
}

let frames = 0;
let lastDt = -1;
const loop = createLoop((dt) => {
  frames++;
  lastDt = dt;
});

// Nothing before `start`, so a page that throws on the way up is not left
// running a loop over a half-built world.
check(!running(), "nothing is scheduled before start");

loop.start();
check(running(), "start runs the loop");
check(!loop.paused, "a started loop is not paused");

deliver();
check(frames === 1, "a delivered frame is a frame");
check(running(), "a frame schedules the next one");

// -- the player pauses ------------------------------------------------------

loop.setPaused(true);
check(loop.paused, "pausing reads as paused");
check(!running(), "pausing stops asking for frames");

const framesAtPause = frames;
deliver();
check(frames === framesAtPause, "no frames arrive while paused");

// The one that matters. Tab away from a paused page and come back: it is still
// paused, and nothing is running.
setHidden(true);
check(!running(), "hiding an already-paused loop keeps it stopped");
setHidden(false);
check(!running(), "returning to a paused tab does NOT start the world again");
check(loop.paused, "returning to a paused tab leaves it paused");

loop.setPaused(false);
check(!loop.paused, "unpausing reads as not paused");
check(running(), "unpausing asks for frames again");

// -- hidden, then paused, in the other order --------------------------------

setHidden(true);
check(!running(), "hiding stops the loop");
check(!loop.paused, "hiding is not pausing");

loop.setPaused(true);
setHidden(false);
check(!running(), "a pause made while hidden survives being shown again");

// ...and unpausing while still hidden must not start it either.
setHidden(true);
loop.setPaused(false);
check(!running(), "unpausing a hidden tab does not start the world");
setHidden(false);
check(running(), "shown and unpaused runs");

// -- repeated calls are not compound ---------------------------------------

loop.setPaused(true);
loop.setPaused(true);
loop.setPaused(false);
check(running(), "pausing twice still takes one unpause");

setHidden(true);
setHidden(true);
setHidden(false);
check(running(), "a repeated hide still takes one show");

// -- the still frame -------------------------------------------------------

loop.setPaused(true);
const before = frames;
const elapsedBefore = loop.elapsed;
loop.renderStill();
check(frames === before + 1, "a still frame is drawn while paused");
check(lastDt === 0, "a still frame advances nothing");
check(loop.elapsed === elapsedBefore, "a still frame does not age the world");
check(!running(), "a still frame does not restart the loop");

// -- stop ------------------------------------------------------------------

loop.setPaused(false);
check(running(), "still running before stop");
loop.stop();
check(!running(), "stop stops");
setHidden(false);
check(!running(), "a stopped loop is not revived by a visibility change");

// A long stall must not integrate into one huge step.
loop.start();
deliver();
deliver(9_000);
check(lastDt > 0 && lastDt <= 0.2, "a long stall is clamped to a small step");
loop.stop();

if (failures.length > 0) {
  console.error(`Pause check failed (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`${passed} pause checks passed. A pause is not undone by a tab switch.`);
