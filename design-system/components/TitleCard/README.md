# TitleCard

Shown once over the opening swim: the logo mark, the name, and a three-colour rule (leaf, sun, coral) cut as a trapezoid (source `.title-card`).

**Markup:** `.cu-title` containing `<img class="cu-title__mark">` (the `logo-mark.png` asset), `<h1 class="cu-title__word">Currents</h1>` and `.cu-title__rule`.

- The name is uppercase `title-word`, with `text-indent` equal to its tracking.
- Hide the mark below 560px of viewport height.
- Fade in and out over 1.2s. It is never a gate.
