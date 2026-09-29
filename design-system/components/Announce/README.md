# Announce

The animal's name, shown for a moment after a change, centred low on the screen (source `.announce`).

**Markup:** `<div class="cu-announce" aria-live="polite">Manta Ray</div>`. The consumer sets the text and toggles visibility the source way: `data-show`, 0.14s in and 0.9s out.

- Uppercase `announce` type in `ink`, with a small `sun` trapezoid underline.
- It stays outside the HUD, so it still shows when the hints have faded.
