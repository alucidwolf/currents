# HudHints

The fading row of control hints across the top of the screen (source `.hud__hints`).

**Markup:** `<div class="cu-hints">` with one `<span>` per hint. Put the gesture word in `<b>` and a key in a `Keycap`.

- `ink-dim` text with `ink` bold words, `hud` type, `space-5` gaps.
- It sits inside the pointer-transparent `.hud`, which fades via `data-faded` over 1.6s. That behaviour is unchanged.
- Hints are phrased "<gesture> to <verb>", lowercase after the gesture.
