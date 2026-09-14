/**
 * Text overlay: control hints, the world seed, and an optional stats readout.
 *
 * The hints fade themselves out after a few seconds of stillness and come back
 * on the first sign of life, so an unattended screen ends up clean without the
 * player having to dismiss anything.
 */

/** Seconds of no input before the hints fade away. */
const FADE_AFTER = 6;

export interface HudStats {
  fps: number;
  chunks: number;
  pending: number;
  drawCalls: number;
  triangles: number;
  programs: number;
  depth: number;
  speed: number;
  clamped: boolean;
  target: string | null;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly seedEl: HTMLElement;
  private readonly statsEl: HTMLElement;

  private hintsHidden = false;
  private statsVisible = false;
  private statsTimer = 0;

  constructor() {
    this.root = document.getElementById("hud")!;
    this.seedEl = document.getElementById("hud-seed")!;
    this.statsEl = document.getElementById("stats")!;

    window.addEventListener("keydown", (event) => {
      if (event.key === "h" || event.key === "H") {
        this.hintsHidden = !this.hintsHidden;
        this.root.dataset.hidden = String(this.hintsHidden);
      }
      if (event.key === "f" || event.key === "F") {
        this.statsVisible = !this.statsVisible;
        this.statsEl.hidden = !this.statsVisible;
      }
    });
  }

  setSeed(seed: string): void {
    this.seedEl.textContent = `seed ${seed}`;
  }

  /** Start with the overlay already faded, for unattended displays. */
  setAmbient(): void {
    this.root.dataset.faded = "true";
  }

  update(dt: number, idleTime: number, stats: HudStats): void {
    this.root.dataset.faded = String(idleTime > FADE_AFTER);

    if (!this.statsVisible) return;

    // Refreshing text every frame is pointless churn and makes the numbers
    // unreadable; four times a second is plenty to spot a problem.
    this.statsTimer += dt;
    if (this.statsTimer < 0.25) return;
    this.statsTimer = 0;

    this.statsEl.textContent = [
      `fps       ${stats.fps.toFixed(0).padStart(5)}`,
      `draws     ${String(stats.drawCalls).padStart(5)}`,
      `tris      ${String(stats.triangles).padStart(5)}`,
      `programs  ${String(stats.programs).padStart(5)}`,
      `chunks    ${String(stats.chunks).padStart(5)}${
        stats.pending > 0 ? ` (+${stats.pending})` : ""
      }`,
      `depth     ${stats.depth.toFixed(1).padStart(5)}m`,
      `speed     ${stats.speed.toFixed(2).padStart(5)}`,
      `clamped   ${String(stats.clamped).padStart(5)}`,
      `curious   ${stats.target ?? "—"}`,
    ].join("\n");
  }
}
