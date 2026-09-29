# PickerCard

One animal choice in the picker: a faceted tile with a Keycap, a display-face name and a one-line blurb (source `.picker__card`).

**Markup:** `<button class="cu-card cu-facet" aria-pressed>` containing a `Keycap`, `.cu-card__name` and `.cu-card__blurb`. The consumer supplies the species name, the blurb and the number key.

- For the current animal, set `aria-pressed="true"`. This turns the outline `leaf` and adds a short leaf bar at the bottom.
- On hover, it rises 3px.
- Blurbs are one short, dry sentence. Match the tone of "All wing. Flies more than it swims."
