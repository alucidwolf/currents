# CreatureRecipe

A reference card, not UI. It shows each animal's four-part colour blocking (back, warm-cream belly, dark tips and one accent) and its dot eye, as flat facets against shallow water.

Use it when retuning `applyCountershading` and `overlayPattern` colours in `src/creatures/species.ts`. The shapes are schematic lozenges, not the animals' silhouettes. For the rules, see the Creatures & world section.

- The shallow-water tile (`world-shallow`) is the ground each animal must separate from. Do that through the back/belly value split, not by adding outlines.
