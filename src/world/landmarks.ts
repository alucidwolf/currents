import * as THREE from "three";
import { WORLD } from "../core/config";
import { chunkRng, randRange } from "../core/rng";
import type { Rng } from "../core/rng";
import { buildBody } from "../creatures/shapes";

/**
 * Rare landmarks on the seabed.
 *
 * An endlessly generated world has a characteristic failure: everywhere is
 * equally interesting, which means nowhere is. Wrecks exist to break that.
 * They are deliberately uncommon — roughly one per seventy chunks — so that
 * coming over a rise and finding one is an event rather than scenery.
 *
 * A wreck is built broken in two, with the halves settled at different angles
 * and a gap of open sand between them. That silhouette reads as "sunk" at a
 * distance far better than an intact hull, which just reads as a boat.
 */

/** Roughly one chunk in seventy holds a wreck. */
const WRECK_CHANCE = 1 / 70;

const HULL = 0x4a4036;
const HULL_DARK = 0x38302a;
const DECK = 0x5a4e3e;
const RUST = 0x6d4630;

export interface LandmarkPart {
  geometry: THREE.BufferGeometry;
  color: number;
}

export interface ShipwreckPlacement {
  /** Position within the chunk, in chunk-local coordinates. */
  localX: number;
  localZ: number;
  yaw: number;
  /** List to one side, as a settled wreck would. */
  roll: number;
  pitch: number;
  scale: number;
  /** How far the hull has sunk into the sand. */
  bury: number;
}

/**
 * Decide whether a chunk holds a wreck, deterministically.
 *
 * Keyed on the chunk coordinates and world seed alone, so the answer is stable
 * however many times the chunk streams in and out, and so the same seed always
 * produces wrecks in the same places.
 */
export function shipwreckForChunk(
  worldSeed: number,
  cx: number,
  cz: number,
): ShipwreckPlacement | null {
  const rng = chunkRng(worldSeed, cx, cz, 0x5b1b);
  if (rng() > WRECK_CHANCE) return null;

  return {
    // Kept away from the chunk edges so the hull does not straddle a boundary
    // and get half-culled when the neighbour unloads.
    localX: randRange(rng, WORLD.chunkSize * 0.25, WORLD.chunkSize * 0.75),
    localZ: randRange(rng, WORLD.chunkSize * 0.25, WORLD.chunkSize * 0.75),
    yaw: rng() * Math.PI * 2,
    roll: randRange(rng, -0.42, 0.42),
    pitch: randRange(rng, -0.16, 0.16),
    scale: randRange(rng, 0.85, 1.45),
    bury: randRange(rng, 1.2, 3.4),
  };
}

/**
 * One hull section.
 *
 * `from` and `to` sample the full ship's beam curve, so a section taken from
 * the bow end genuinely tapers to a point while a midships section stays full
 * — the two halves fit the same original ship.
 */
function buildHullSection(
  length: number,
  beam: number,
  depth: number,
  from: number,
  to: number,
): THREE.BufferGeometry {
  const hull = buildBody({
    length: length * (to - from),
    segments: 20,
    radial: 14,
    radius(t) {
      const shipT = from + (to - from) * t;
      // Fine at the bow, full amidships, tucked in again at the stern.
      const widthCurve = Math.sin(Math.PI * Math.pow(shipT, 0.72));
      return {
        x: 0.05 + widthCurve * beam,
        y: 0.05 + Math.pow(widthCurve, 0.55) * depth,
      };
    },
  });

  // Flatten the upper half: ships have decks, not round backs.
  const position = hull.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    if (y > 0) position.setY(i, y * 0.34);
  }
  hull.computeVertexNormals();
  return hull;
}

/** A tapered spar, for masts and funnels. */
function spar(height: number, radius: number): THREE.BufferGeometry {
  const geometry = buildBody({
    length: height,
    segments: 5,
    radial: 8,
    radius(t) {
      const r = radius * (1 - t * 0.55);
      return { x: r, y: r };
    },
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, height / 2, 0);
  return geometry;
}

/**
 * Build a wreck, broken amidships.
 *
 * Returned in wreck-local space with the keel around y = 0, so the caller only
 * has to place, rotate and sink it.
 */
export function buildShipwreck(rng: Rng): LandmarkPart[] {
  const length = randRange(rng, 24, 34);
  const beam = randRange(rng, 2.6, 3.6);
  const depth = randRange(rng, 2.2, 3.1);
  const gap = randRange(rng, 2.5, 5.5);

  const parts: LandmarkPart[] = [];

  // --- Stern section, settled fairly level -----------------------------------
  const stern = buildHullSection(length, beam, depth, 0, 0.46);
  stern.rotateX(randRange(rng, -0.1, 0.1));
  stern.rotateZ(randRange(rng, -0.22, 0.22));
  stern.translate(0, depth * 0.5, -length * 0.27 - gap * 0.5);
  parts.push({ geometry: stern, color: HULL });

  // --- Bow section, tipped over harder ---------------------------------------
  // Two halves at clearly different angles is what sells the break; matched
  // angles just look like one hull with a slot cut in it.
  const bow = buildHullSection(length, beam, depth, 0.54, 1);
  bow.rotateX(randRange(rng, -0.34, -0.12));
  bow.rotateZ(randRange(rng, -0.55, 0.55));
  bow.translate(
    randRange(rng, -1.5, 1.5),
    depth * 0.45,
    length * 0.26 + gap * 0.5,
  );
  parts.push({ geometry: bow, color: HULL_DARK });

  // --- Deckhouse on the stern ------------------------------------------------
  const houseLength = randRange(rng, 3.2, 5.4);
  const house = new THREE.BoxGeometry(beam * 1.25, randRange(rng, 1.6, 2.5), houseLength);
  house.translate(0, depth * 1.05, -length * 0.3 - gap * 0.5);
  parts.push({ geometry: house, color: DECK });

  // --- Mast, fallen or leaning ----------------------------------------------
  const mastHeight = randRange(rng, 7, 13);
  const mast = spar(mastHeight, randRange(rng, 0.22, 0.38));
  // Mostly toppled: an upright mast makes the wreck look moored rather than lost.
  const fallen = rng() < 0.7;
  mast.rotateZ(fallen ? randRange(rng, 1.0, 1.5) * (rng() < 0.5 ? 1 : -1) : randRange(rng, -0.35, 0.35));
  mast.translate(0, depth * 0.9, -length * 0.1 - gap * 0.5);
  parts.push({ geometry: mast, color: RUST });

  // --- A little debris scattered around --------------------------------------
  const debrisCount = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < debrisCount; i++) {
    const size = randRange(rng, 0.5, 1.7);
    const piece = new THREE.BoxGeometry(size, size * randRange(rng, 0.2, 0.5), size * randRange(rng, 0.7, 2.2));
    piece.rotateY(rng() * Math.PI);
    piece.rotateX(randRange(rng, -0.5, 0.5));
    const around = rng() * Math.PI * 2;
    const spread = randRange(rng, beam * 1.4, length * 0.55);
    piece.translate(Math.sin(around) * spread, size * 0.2, Math.cos(around) * spread);
    parts.push({ geometry: piece, color: rng() < 0.5 ? HULL_DARK : RUST });
  }

  return parts;
}
