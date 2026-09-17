/**
 * Pointer and key input.
 *
 * Two pointer gestures, and they are independent: left-hold-and-drag orbits the
 * camera, right-hold steers the animal. Both can run at once, and both are
 * holds: a plain click on either button does nothing. Everything else the
 * browser wants to do with those buttons — context menus, text selection,
 * drag-to-scroll on touch — is suppressed.
 *
 * The arrow keys are a second way to steer, for anyone who would rather not
 * hold a mouse button down to swim. They are reported here as two smoothed
 * axes rather than as raw key state, because a key is a step input and the
 * animal should lean into a turn rather than snap into one.
 */

import { POINTER, SWIM } from "../core/config";

export interface InputState {
  /** Accumulated left-drag since the last frame consumed it, in pixels. */
  dragX: number;
  dragY: number;
  /** Accumulated wheel delta since the last frame consumed it. */
  wheel: number;
  /** True while the right button is held: the swimmer is under player command. */
  steering: boolean;
  /** Smoothed arrow-key steering: -1 is left/down, +1 is right/up. */
  steerX: number;
  steerY: number;
  /**
   * True while the arrow keys have authority over the animal.
   *
   * Stays true through the ease-out after the last key is released, so the turn
   * unwinds under the player's command rather than being handed back to the
   * autopilot mid-lean.
   */
  keySteering: boolean;
  /** Cursor in normalised device coordinates, for unprojecting a steer target. */
  ndcX: number;
  ndcY: number;
  /** Seconds since the last input of any kind. Drives idle camera and HUD fade. */
  idleTime: number;
}

export interface Input extends InputState {
  /** Zero the per-frame accumulators. Call once per frame after reading them. */
  consume(): void;
  /** Advance the idle timer. Any input resets it to zero. */
  tick(dt: number): void;
  /**
   * Hand the arrow keys to an overlay, or take them back.
   *
   * Only one thing can own them at a time: with a picker open, arrows move
   * between its choices, and the animal steering off in the background while
   * you read a menu is nobody's intention. Turning this off also drops whatever
   * is currently held, so a key still down when the overlay opened does not
   * come back the moment it closes.
   */
  setSteeringEnabled(enabled: boolean): void;
  dispose(): void;
}

export function createInput(target: HTMLElement): Input {
  const state: InputState = {
    dragX: 0,
    dragY: 0,
    wheel: 0,
    steering: false,
    steerX: 0,
    steerY: 0,
    keySteering: false,
    ndcX: 0,
    ndcY: 0,
    idleTime: 0,
  };

  let orbitPointerId: number | null = null;
  let steerPointerId: number | null = null;
  // How long each button has been down. A gesture only takes effect once its
  // button has been held past `POINTER.holdDelay`, so a click does nothing.
  let orbitHeldFor = 0;
  let steerHeldFor = 0;
  let lastX = 0;
  let lastY = 0;

  const held = { left: false, right: false, up: false, down: false };
  type Arrow = keyof typeof held;
  let steeringEnabled = true;

  const ARROWS: Record<string, Arrow> = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
  };

  const markActive = () => {
    state.idleTime = 0;
  };

  const updateNdc = (event: PointerEvent) => {
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    state.ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    state.ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  };

  const onPointerDown = (event: PointerEvent) => {
    markActive();
    updateNdc(event);

    if (event.button === 0 && orbitPointerId === null) {
      orbitPointerId = event.pointerId;
      orbitHeldFor = 0;
      lastX = event.clientX;
      lastY = event.clientY;
      target.setPointerCapture(event.pointerId);
      event.preventDefault();
    } else if (event.button === 2 && steerPointerId === null) {
      // Steering itself starts in `tick`, once the button has been held.
      steerPointerId = event.pointerId;
      steerHeldFor = 0;
      target.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    markActive();
    updateNdc(event);

    if (event.pointerId === orbitPointerId) {
      // Movement before the hold registers is dropped rather than saved up, so
      // the camera starts from where the cursor is instead of jumping to catch
      // up with it.
      if (orbitHeldFor >= POINTER.holdDelay) {
        state.dragX += event.clientX - lastX;
        state.dragY += event.clientY - lastY;
      }
      lastX = event.clientX;
      lastY = event.clientY;
    }
  };

  const release = (event: PointerEvent) => {
    if (event.pointerId === orbitPointerId) {
      orbitPointerId = null;
      orbitHeldFor = 0;
    }
    if (event.pointerId === steerPointerId) {
      steerPointerId = null;
      steerHeldFor = 0;
      state.steering = false;
    }
    if (target.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    markActive();
    release(event);
  };

  const onWheel = (event: WheelEvent) => {
    markActive();
    state.wheel += event.deltaY;
    event.preventDefault();
  };

  const onContextMenu = (event: Event) => {
    // Without this, right-hold-to-steer pops the browser menu on every turn.
    event.preventDefault();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    markActive();

    const arrow = ARROWS[event.key];
    // Leave modified arrows alone — Alt+Left is the browser's back button, and
    // taking it over would be a genuinely annoying thing for a page to do.
    if (!arrow || event.altKey || event.ctrlKey || event.metaKey) return;
    // An overlay has the keyboard; let the arrows through to it untouched.
    if (!steeringEnabled) return;

    held[arrow] = true;
    // Otherwise the page scrolls under the canvas on every turn.
    event.preventDefault();
  };

  const onKeyUp = (event: KeyboardEvent) => {
    markActive();
    const arrow = ARROWS[event.key];
    if (arrow) held[arrow] = false;
  };

  /**
   * Drop every held key.
   *
   * A keyup that arrives while the window is not focused is never delivered, so
   * alt-tabbing mid-turn would otherwise leave the animal circling forever with
   * no key down to explain it.
   */
  const releaseKeys = () => {
    held.left = held.right = held.up = held.down = false;
  };

  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointermove", onPointerMove);
  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("pointercancel", onPointerUp);
  target.addEventListener("wheel", onWheel, { passive: false });
  target.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", releaseKeys);

  return {
    get dragX() {
      return state.dragX;
    },
    get dragY() {
      return state.dragY;
    },
    get wheel() {
      return state.wheel;
    },
    get steering() {
      return state.steering;
    },
    get steerX() {
      return state.steerX;
    },
    get steerY() {
      return state.steerY;
    },
    get keySteering() {
      return state.keySteering;
    },
    get ndcX() {
      return state.ndcX;
    },
    get ndcY() {
      return state.ndcY;
    },
    get idleTime() {
      return state.idleTime;
    },
    consume() {
      state.dragX = 0;
      state.dragY = 0;
      state.wheel = 0;
    },
    tick(dt: number) {
      state.idleTime += dt;

      if (orbitPointerId !== null) orbitHeldFor += dt;
      if (steerPointerId !== null) {
        steerHeldFor += dt;
        state.steering = steerHeldFor >= POINTER.holdDelay;
      }

      const wantX = (held.right ? 1 : 0) - (held.left ? 1 : 0);
      const wantY = (held.up ? 1 : 0) - (held.down ? 1 : 0);
      const ease = Math.min(1, dt * SWIM.keySteerResponse);

      state.steerX += (wantX - state.steerX) * ease;
      state.steerY += (wantY - state.steerY) * ease;

      // An exponential ease never quite reaches its target, so snap the tail to
      // zero. Without this the axes hold a vanishing residue forever and the
      // autopilot is never handed back.
      if (wantX === 0 && Math.abs(state.steerX) < 0.004) state.steerX = 0;
      if (wantY === 0 && Math.abs(state.steerY) < 0.004) state.steerY = 0;

      state.keySteering = state.steerX !== 0 || state.steerY !== 0;
    },
    setSteeringEnabled(enabled: boolean) {
      steeringEnabled = enabled;
      // Dropping the held keys rather than remembering them: the eased axes
      // then unwind on their own, so the animal finishes its turn gently
      // instead of stopping dead the instant an overlay opens.
      if (!enabled) releaseKeys();
    },
    dispose() {
      target.removeEventListener("pointerdown", onPointerDown);
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onPointerUp);
      target.removeEventListener("pointercancel", onPointerUp);
      target.removeEventListener("wheel", onWheel);
      target.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseKeys);
    },
  };
}
