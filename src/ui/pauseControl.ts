/**
 * Stopping the world, and the system setting that asks us to start it stopped.
 *
 * Two ways in — a button in the HUD and the space bar — because this is the one
 * control on the page somebody may need before they have found anything else.
 * A page that moves constantly is a problem for a narrow but real set of people,
 * and `prefers-reduced-motion` is how their machine says so. Honouring it here
 * means the ocean is a still picture until it is asked to move, rather than
 * something to be caught and stopped.
 *
 * Pausing deliberately holds the HUD open. The overlay fades itself out after a
 * few seconds of stillness, and a paused page is nothing but stillness — without
 * this the controls would fade away moments after being used, leaving a frozen
 * ocean and no visible way to start it again.
 */

/** Does this machine ask for less movement? */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // Very old or very unusual browsers have no matchMedia. Assume the ordinary
    // case rather than starting every one of them paused.
    return false;
  }
}

/**
 * Typing into something else is not a request to pause.
 *
 * Space activates whatever button has focus, so without this, tabbing to the
 * sound switch and pressing space would both flip the sound and stop the
 * ocean — the second of which nobody asked for.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "A"].includes(target.tagName);
}

export class PauseControl {
  private readonly button: HTMLButtonElement;
  private readonly hud: HTMLElement;
  private isPaused = false;

  constructor(
    /** Called with the new state whenever it changes. */
    private readonly onChange: (paused: boolean) => void,
    /** True while an overlay owns the keyboard, so space belongs to it. */
    private readonly keyboardTaken: () => boolean,
  ) {
    this.button = document.getElementById("pause-toggle") as HTMLButtonElement;
    this.hud = document.getElementById("hud")!;

    this.button.addEventListener("click", () => this.toggle());

    window.addEventListener("keydown", (event) => {
      if (event.key !== " " && event.key !== "Spacebar") return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (this.keyboardTaken()) return;
      if (isTypingTarget(event.target)) return;
      // Otherwise the page scrolls under the canvas on every pause.
      event.preventDefault();
      this.toggle();
    });

    this.render();
  }

  get paused(): boolean {
    return this.isPaused;
  }

  toggle(): void {
    this.set(!this.isPaused);
  }

  /**
   * Go to a state, whoever asked.
   *
   * Public so the opening reduced-motion pause runs through exactly the path a
   * button press does. An earlier version had a second method that set the
   * button's own state without telling anything else, which meant the first
   * pause of a reduced-motion visit had to be applied twice, in two places, and
   * could be half-applied if either were changed alone.
   */
  set(paused: boolean): void {
    if (paused === this.isPaused) return;
    this.isPaused = paused;
    this.render();
    this.onChange(paused);
  }

  private render(): void {
    this.button.textContent = this.isPaused ? "play" : "pause";
    this.button.setAttribute("aria-pressed", String(this.isPaused));
    this.button.setAttribute(
      "aria-label",
      this.isPaused ? "Start the ocean moving" : "Hold the ocean still",
    );
    this.button.dataset.on = String(this.isPaused);
    // Read by the stylesheet to defeat the idle fade. A paused page never
    // reaches the HUD's own update, so this is the only thing keeping the
    // controls on screen.
    this.hud.dataset.paused = String(this.isPaused);
  }
}
