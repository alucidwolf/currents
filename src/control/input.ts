/**
 * Pointer input.
 *
 * Two gestures only, and they are independent: left-drag orbits the camera,
 * right-hold steers the animal. Both can run at once. Everything else the
 * browser wants to do with those buttons — context menus, text selection,
 * drag-to-scroll on touch — is suppressed.
 */

export interface InputState {
  /** Accumulated left-drag since the last frame consumed it, in pixels. */
  dragX: number;
  dragY: number;
  /** Accumulated wheel delta since the last frame consumed it. */
  wheel: number;
  /** True while the right button is held: the swimmer is under player command. */
  steering: boolean;
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
  dispose(): void;
}

export function createInput(target: HTMLElement): Input {
  const state: InputState = {
    dragX: 0,
    dragY: 0,
    wheel: 0,
    steering: false,
    ndcX: 0,
    ndcY: 0,
    idleTime: 0,
  };

  let orbitPointerId: number | null = null;
  let steerPointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;

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
      lastX = event.clientX;
      lastY = event.clientY;
      target.setPointerCapture(event.pointerId);
      event.preventDefault();
    } else if (event.button === 2 && steerPointerId === null) {
      steerPointerId = event.pointerId;
      state.steering = true;
      target.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    markActive();
    updateNdc(event);

    if (event.pointerId === orbitPointerId) {
      state.dragX += event.clientX - lastX;
      state.dragY += event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
    }
  };

  const release = (event: PointerEvent) => {
    if (event.pointerId === orbitPointerId) {
      orbitPointerId = null;
    }
    if (event.pointerId === steerPointerId) {
      steerPointerId = null;
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

  const onKey = () => markActive();

  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointermove", onPointerMove);
  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("pointercancel", onPointerUp);
  target.addEventListener("wheel", onWheel, { passive: false });
  target.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKey);

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
    },
    dispose() {
      target.removeEventListener("pointerdown", onPointerDown);
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onPointerUp);
      target.removeEventListener("pointercancel", onPointerUp);
      target.removeEventListener("wheel", onWheel);
      target.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKey);
    },
  };
}
