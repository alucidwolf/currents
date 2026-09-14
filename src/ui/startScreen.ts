import { SPECIES } from "../creatures/species";
import type { SpeciesDef } from "../creatures/species";

/**
 * The one screen with any chrome on it.
 *
 * It resolves as soon as a species is chosen and then fades out for good — the
 * game itself never shows another menu. The `#ambient` fragment skips this
 * entirely, which is the mode you leave running on a second monitor.
 */
export function showStartScreen(options: {
  root: HTMLElement;
  choicesHost: HTMLElement;
  reseedButton: HTMLElement;
  onReseed: () => void;
}): Promise<SpeciesDef> {
  const { root, choicesHost, reseedButton, onReseed } = options;

  return new Promise((resolve) => {
    for (const species of SPECIES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice";
      button.innerHTML = `
        <span class="choice__name"></span>
        <span class="choice__blurb"></span>
      `;
      // Assigned rather than interpolated so species copy can never be parsed
      // as markup.
      button.querySelector(".choice__name")!.textContent = species.name;
      button.querySelector(".choice__blurb")!.textContent = species.blurb;

      button.addEventListener("click", () => {
        root.dataset.dismissed = "true";
        // Leave the node in the DOM until the fade finishes, then drop it so
        // it can never swallow a pointer event.
        window.setTimeout(() => root.remove(), 1100);
        resolve(species);
      });

      choicesHost.appendChild(button);
    }

    reseedButton.addEventListener("click", onReseed);
  });
}

/** True when the page was opened as an unattended ambient display. */
export function isAmbientMode(hash: string = location.hash): boolean {
  return /(?:^|[#&])ambient(?:&|=|$)/.test(hash);
}
