import { SPECIES } from "../creatures/species";
import type { SpeciesDef } from "../creatures/species";

/**
 * Choosing an animal, by pointing at one.
 *
 * Deliberately not the start screen that used to be here. That one stood
 * between the page loading and the ocean, and had to be cleared before anything
 * happened; this one is opened on purpose, sits over a swim already in
 * progress, and closes on almost anything. Nothing waits on it — the animal
 * carries on swimming behind it the entire time, which is also why choosing
 * from it is instant rather than a commitment.
 *
 * The number keys still work and are still listed on each card. They are the
 * accelerator, not the interface: a control nobody can see is not a way to
 * change animal, it is a thing you have to already know.
 */
export class SpeciesPicker {
  private readonly root: HTMLElement;
  private readonly cardHost: HTMLElement;
  private readonly trigger: HTMLButtonElement;
  private readonly triggerLabel: HTMLElement;
  private readonly cards = new Map<string, HTMLButtonElement>();

  private open = false;
  private current: SpeciesDef | null = null;

  constructor(
    private readonly onChoose: (species: SpeciesDef) => void,
    /** Called with true while the picker owns the keyboard. */
    private readonly onKeyboardOwnership: (owned: boolean) => void,
  ) {
    this.root = document.getElementById("picker")!;
    this.cardHost = document.getElementById("picker-choices")!;
    this.trigger = document.getElementById("animal-trigger") as HTMLButtonElement;
    this.triggerLabel = document.getElementById("animal-trigger-label")!;

    this.buildCards();

    this.trigger.addEventListener("click", () => this.toggle());

    // Anywhere off the panel closes it. The backdrop is the element itself, so
    // this only fires when the click missed everything inside.
    this.root.addEventListener("pointerdown", (event) => {
      if (event.target === this.root) this.hide();
    });

    this.root.addEventListener("keydown", (event) => this.onDialogKey(event));
  }

  /** Reflect a change of animal, however it was made. */
  setCurrent(species: SpeciesDef): void {
    this.current = species;
    this.triggerLabel.textContent = species.name;

    for (const [id, card] of this.cards) {
      const isCurrent = id === species.id;
      card.dataset.current = String(isCurrent);
      // `aria-pressed` rather than `aria-selected`: these are buttons that
      // change something, not options in a listbox.
      card.setAttribute("aria-pressed", String(isCurrent));
    }
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.root.hidden = false;
    this.trigger.setAttribute("aria-expanded", "true");
    this.onKeyboardOwnership(true);

    // Two frames of nothing would let the transition be skipped entirely: the
    // element has to be laid out unhidden before the class change can animate.
    requestAnimationFrame(() => {
      this.root.dataset.show = "true";
    });

    const focusTarget =
      (this.current && this.cards.get(this.current.id)) ??
      (this.cardHost.firstElementChild as HTMLButtonElement | null);
    focusTarget?.focus();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.dataset.show = "false";
    this.trigger.setAttribute("aria-expanded", "false");
    this.onKeyboardOwnership(false);

    // Hidden only once faded, or it would vanish rather than leave.
    window.setTimeout(() => {
      if (!this.open) this.root.hidden = true;
    }, 260);

    // Back where it came from, so the keyboard is not left at the top of the
    // document after a visit.
    this.trigger.focus();
  }

  private buildCards(): void {
    SPECIES.forEach((species, index) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "picker__card";
      card.dataset.speciesId = species.id;
      card.innerHTML = `
        <span class="picker__key" aria-hidden="true"></span>
        <span class="picker__name"></span>
        <span class="picker__blurb"></span>
      `;
      // Assigned rather than interpolated, so species copy can never be parsed
      // as markup.
      card.querySelector(".picker__key")!.textContent = String(index + 1);
      card.querySelector(".picker__name")!.textContent = species.name;
      card.querySelector(".picker__blurb")!.textContent = species.blurb;

      card.addEventListener("click", () => {
        this.onChoose(species);
        this.hide();
      });

      this.cards.set(species.id, card);
      this.cardHost.appendChild(card);
    });
  }

  /**
   * Keyboard inside the panel.
   *
   * Arrows move between the animals rather than steering, which is the whole
   * reason the picker takes the keyboard while it is open. Tab is wrapped by
   * hand: the cards are the only things worth reaching in here, and letting
   * focus escape into the page behind an open dialog is how you end up typing
   * at something you cannot see.
   */
  private onDialogKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.hide();
      return;
    }

    const order = [...this.cards.values()];
    const here = order.indexOf(document.activeElement as HTMLButtonElement);

    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : event.key === "Tab"
            ? event.shiftKey
              ? -1
              : 1
            : 0;

    if (step === 0) return;

    event.preventDefault();
    const from = here === -1 ? 0 : here;
    order[(from + step + order.length) % order.length]?.focus();
  }
}
