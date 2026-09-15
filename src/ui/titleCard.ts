/**
 * The logo, once, over the opening water.
 *
 * With no menu there is nowhere else for it: the mark used to crest the animal
 * picker, and removing the picker would otherwise mean the game never shows its
 * own name. Shown over a moving ocean rather than over a held screen, so it
 * costs nobody any time — the swim has already started behind it.
 *
 * It leaves on its own, and leaves sooner if touched. Anybody who reaches for
 * the mouse has stopped looking at a logo and started looking at an ocean, and
 * the card should be out of the way before they notice it was ever there.
 */

/** Seconds the card holds before fading of its own accord. */
const HOLD = 3.4;

export class TitleCard {
  private readonly root: HTMLElement;
  private remaining = 0;
  private dismissed = true;

  constructor() {
    this.root = document.getElementById("title-card")!;
  }

  show(): void {
    this.root.dataset.show = "true";
    this.remaining = HOLD;
    this.dismissed = false;

    const onInput = () => this.dismiss();
    // `once` on each, so the listeners clean themselves up whichever fires.
    window.addEventListener("pointerdown", onInput, { once: true });
    window.addEventListener("keydown", onInput, { once: true });
    window.addEventListener("wheel", onInput, { once: true, passive: true });
  }

  update(dt: number): void {
    if (this.dismissed) return;
    this.remaining -= dt;
    if (this.remaining <= 0) this.dismiss();
  }

  private dismiss(): void {
    if (this.dismissed) return;
    this.dismissed = true;
    this.root.dataset.show = "false";
    // Removed once faded, so it can never intercept a pointer.
    window.setTimeout(() => this.root.remove(), 1400);
  }
}
