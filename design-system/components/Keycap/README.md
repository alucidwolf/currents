# Keycap

A small faceted block that names a key, the TUNIC-manual way of showing controls.

Use inside hints, on picker cards (the number accelerator) and anywhere a keyboard shortcut is mentioned. Replaces the source's bare `<b>` key words and the `.picker__key` corner label.

**Markup:** `<span class="cu-key cu-facet">Tab</span>`. The consumer supplies the key label: one to four characters or an arrow glyph.

- Letters are `sun` on `panel` (8.3:1 deep).
- Keep it decorative. It is never a button, so give it no role or tabindex.
- Don't use it for words. "Drag" and "Scroll" stay bold text in `HudHints`.
