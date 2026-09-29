# SoundControl

A faceted glass group holding the sound toggle and volume slider (source `.sound`).

**Markup:** `<div class="cu-sound cu-facet" role="group" aria-label="Sound">` containing `<button class="cu-sound__toggle" aria-pressed>` and `<input type="range" class="cu-sound__volume">`. The consumer sets `aria-pressed` and the label text ("sound on" / "sound off", lowercase).

- The diamond pip is `coral` when on and `ink-dim` when off, and the label changes too, so state never depends on colour alone.
- The slider uses `accent-sea` as its accent colour.
