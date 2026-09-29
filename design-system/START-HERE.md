# Currents design system: start here

This folder is the Currents design system, exported from Claude. It's a TUNIC-inspired direction for Currents.

Read these in order:

1. `README.md`: the UI rules (colour, type, faceted controls, voice) and how they map onto `src/styles.css`, `index.html` and `src/ui/*.ts`.
2. `art-direction.md`: the 3D rules for creatures, water, seabed and props (facets, toy proportions, dot eyes, colour blocking), with implementation steps for `species.ts`, `swimShader.ts` and the `src/world` files.
3. `tokens.json` / `tokens.css`: every value. The `form` family holds the 3D targets.
4. `components/*/README.md` and `components/bundle.css`: a reference implementation of each UI piece (`cu-*` classes). `preview.html` shows the markup.

Rules:

- Keep every element id, `aria-*` attribute and `data-*` state hook.
- Don't change the `WATER` or `DAY` colours.
- Run `npm run build` and every `npm run verify:*` script after each change.
