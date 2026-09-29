/**
 * Handing someone this exact ocean.
 *
 * Almost all of this was already done: the seed and the current animal are kept
 * in the address as the swim goes on, so the address bar is always a link to
 * the ocean on screen. What was missing was any sign of that. This is the sign.
 *
 * Copying is the one thing on this page that can be refused by the browser
 * rather than merely fail — the clipboard needs a secure context and, in some
 * settings, permission. So there are two ways to try it, and an honest answer
 * if neither works: the link is the address bar, so there is always somewhere
 * to point. The button says which happened, because a copy button that quietly
 * did nothing is worse than one that admits it.
 *
 * Feedback runs on a timer of its own rather than on the frame loop, because
 * this button has to work while the world is paused, which is exactly when the
 * frame loop is not running.
 */

/** Seconds the button holds its result before going back to the offer. */
const HOLD = 2;

export class ShareControl {
  private readonly button: HTMLButtonElement;
  private revert = 0;

  constructor() {
    this.button = document.getElementById("share-link") as HTMLButtonElement;
    this.button.addEventListener("click", () => {
      void this.copy();
    });
  }

  private async copy(): Promise<void> {
    if (await writeToClipboard(location.href)) this.say("link copied");
    // Nothing is lost when copying is refused: the link is the address bar, and
    // always has been. Saying so is a better answer than any fallback, and it
    // is the reason this button does not need one.
    else this.say("use the address bar");
  }

  private say(message: string): void {
    this.button.textContent = message;
    this.button.dataset.said = "true";
    window.clearTimeout(this.revert);
    this.revert = window.setTimeout(() => {
      this.button.textContent = "copy link";
      this.button.dataset.said = "false";
    }, HOLD * 1000);
  }
}

/** The modern path, then the old one. Either counts as copied. */
async function writeToClipboard(text: string): Promise<boolean> {
  const clipboard = navigator.clipboard;
  try {
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused, or no secure context. Fall through and try the old way.
  }

  return copyViaSelection(text);
}

/**
 * The old way: select the text and tell the browser to copy the selection.
 *
 * `execCommand` is deprecated and still the only thing that works on a page
 * served over plain http, which includes anybody opening this from another
 * machine on their own network by IP.
 *
 * The field it needs is real and focusable — not `hidden`, not `display: none`,
 * because selection does not work on something the browser considers invisible,
 * which is the usual reason a hand-rolled copy silently fails. It is created,
 * used and removed inside this one call, and whatever had focus gets it back;
 * an earlier version left the field on the page for the person to copy from by
 * hand, and because a blur never arrives in a background tab, those fields
 * quietly piled up off the side of the layout, each one a stop in the tab order.
 */
function copyViaSelection(text: string): boolean {
  const wasFocused = document.activeElement;
  let field: HTMLInputElement | null = null;
  try {
    field = document.createElement("input");
    field.value = text;
    field.setAttribute("readonly", "");
    field.setAttribute("aria-hidden", "true");
    field.style.position = "fixed";
    field.style.top = "0";
    field.style.left = "-100vw";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.focus();
    field.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field?.remove();
    if (wasFocused instanceof HTMLElement) wasFocused.focus();
  }
}
