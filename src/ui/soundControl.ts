import type { Soundscape } from "../audio/soundscape";

/**
 * The sound switch and volume slider in the HUD, and the M key.
 *
 * Both sit in the HUD, so they fade with the hints and come back on the first
 * movement. Every change is handed to `onChange` so it can be remembered.
 */
export class SoundControl {
  private readonly toggle: HTMLButtonElement;
  private readonly slider: HTMLInputElement;

  constructor(
    private readonly sound: Soundscape,
    private readonly onChange: () => void,
  ) {
    this.toggle = document.getElementById("sound-toggle") as HTMLButtonElement;
    this.slider = document.getElementById("sound-volume") as HTMLInputElement;

    this.slider.value = String(sound.volume);
    this.render();

    this.toggle.addEventListener("click", () => this.setMuted(!this.sound.muted));

    this.slider.addEventListener("input", () => {
      this.sound.setVolume(Number(this.slider.value));
      // Dragging the volume up is asking to hear it.
      if (this.sound.muted && this.sound.volume > 0) this.sound.setMuted(false);
      this.render();
      this.onChange();
    });

    // The arrows steer the animal from anywhere on the page, so a focused
    // slider has to keep them to itself or it could never be moved from the
    // keyboard.
    this.slider.addEventListener("keydown", (event) => {
      if (event.key.startsWith("Arrow")) event.stopPropagation();
    });

    // After a mouse drag the slider would otherwise keep focus, and the arrows
    // would go on nudging the volume instead of steering.
    this.slider.addEventListener("pointerup", () => this.slider.blur());

    window.addEventListener("keydown", (event) => {
      if (event.key !== "m" && event.key !== "M") return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      this.setMuted(!this.sound.muted);
    });
  }

  /** Reflect a browser that cannot make sound at all. */
  refresh(): void {
    this.render();
  }

  private setMuted(muted: boolean): void {
    this.sound.setMuted(muted);
    this.render();
    this.onChange();
  }

  private render(): void {
    if (this.sound.isUnavailable) {
      this.toggle.textContent = "no sound";
      this.toggle.disabled = true;
      this.slider.disabled = true;
      return;
    }
    const on = !this.sound.muted;
    this.toggle.textContent = on ? "sound on" : "sound off";
    this.toggle.setAttribute("aria-pressed", String(on));
    this.toggle.dataset.on = String(on);
  }
}
