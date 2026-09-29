# AnimalTrigger

The one visible way to change animal: a faceted glass tile with the ray silhouette, a caption and the current animal's name (source `.animal-trigger`).

**Markup:** `<button class="cu-trigger cu-facet" aria-haspopup="dialog" aria-expanded aria-controls="picker">`, containing `.cu-trigger__icon`, then `.cu-trigger__text` holding `.cu-trigger__caption` ("Swimming as") and `.cu-trigger__name`. The consumer supplies the name and keeps `aria-expanded` in sync.

- The face is `glass` over the live ocean; the icon is filled `leaf`.
- On hover, it rises 2px and the outline brightens to `edge-hover`.
- On focus, the whole outline turns `sun`. A clipped tile can't show an outside outline.
- Needs `pointer-events: auto` because it lives inside the pointer-transparent HUD.
