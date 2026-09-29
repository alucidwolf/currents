# Panel

The picker dialog: a large faceted tile with a `bevel-lg` cut, lifted off the water by `shadow-panel` (source `.picker__panel`).

**Markup:** a wrapper `.cu-lift` (it carries the drop shadow, which the clip would otherwise cut off) around `.cu-panel.cu-facet`. Inside go `.cu-panel__title`, `.cu-panel__choices` (a grid of `PickerCard`s) and `.cu-panel__foot`.

- The backdrop stays light (`rgba(4,18,30,0.42)` plus a 3px blur). The ocean keeps moving behind it, and it is not a screen.
- It rises 0.6rem into place over 0.28s, and closes on almost anything.
- Titles are uppercase `picker-title`. The copy is an invitation, not an instruction: "Be something else".
