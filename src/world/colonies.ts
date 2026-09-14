import { WORLD } from "../core/config";
import { chunkRng, randRange } from "../core/rng";
import type { Rng } from "../core/rng";
import type { Terrain } from "./terrain";

/**
 * Where life actually grows on the seabed.
 *
 * Scattering props at random inside each chunk and filtering by a density field
 * gives you *more* coral in some places and *less* in others, but it is still a
 * sprinkle — every prop is equally far from its neighbours, so the floor reads
 * as litter rather than as habitat. Real seabed is not like that. Coral grows
 * outward from a founding head into a colony; kelp grows in beds; loose rock
 * collects in rubble fields where something broke. The interesting structure is
 * the *clustering*, not the density.
 *
 * So placement happens in two stages. This module generates colonies — an
 * ellipse of ground with a kind, a palette and a member list — and the decor
 * builder turns each member into geometry. Between the colonies is genuine open
 * sand, which is what makes arriving at one feel like arriving somewhere.
 *
 * ## Colonies cross chunk borders
 *
 * A colony is anchored to a cell, but its members are in world space and freely
 * spill into the neighbours. If each chunk only knew about its own colonies,
 * every cluster would be sliced off at the chunk boundary.
 *
 * Instead each chunk evaluates the colonies of all nine cells around it and
 * keeps only the members that land inside its own bounds. For that to produce a
 * seamless cluster, two chunks evaluating the same colony must generate exactly
 * the same members — so a colony's generator is seeded from its own cell and
 * index, never from the chunk doing the asking, and colonies are culled by
 * bounding box *before* their members are drawn from that stream rather than
 * after. A colony straddling a border is built half by each side, and the halves
 * meet exactly.
 */

export const enum ColonyKind {
  /** A coral garden, usually built around one large structure. */
  Reef = 0,
  /** A kelp bed: sparser, much more elongated, often on gentler ground. */
  KelpBed = 1,
  /** Broken rock. Geology rather than biology, so it ignores fertility. */
  Rubble = 2,
}

export const enum PropKind {
  Coral = 0,
  Kelp = 1,
  Rock = 2,
  /** One of the large anchor structures — a coral head, table or sponge. */
  Structure = 3,
}

export interface ColonyMember {
  x: number;
  z: number;
  prop: PropKind;
  /** Parametric distance from the colony's heart: 0 at the centre, 1 at the rim. */
  edge: number;
  size: number;
  /** Which prototype to use, in [0, 1). */
  variant: number;
  /**
   * Rotation about the prop's own axis, in [0, 1).
   *
   * Kept separate from `variant` on purpose: derive the two from one number and
   * every instance of a given prototype faces the same way, which is exactly
   * what makes a shared library look like a shared library.
   */
  spin: number;
  /** Which colour to use, in [0, 1). Members of one colony sit close together. */
  tint: number;
  /** Per-prop brightness jitter, so a cluster is not one flat mass of colour. */
  shade: number;
}

/** A colony whose centre falls inside the chunk being built. */
export interface ColonySite {
  key: string;
  x: number;
  z: number;
  kind: ColonyKind;
  /** True when the colony grew a large structure worth swimming over to see. */
  landmark: boolean;
}

export interface ColonyField {
  members: ColonyMember[];
  sites: ColonySite[];
}

/** Colony cells line up with terrain chunks; there is no reason for them not to. */
const CELL = WORLD.chunkSize;

/**
 * Candidate colonies considered per cell. Most are rejected by the fertility
 * test, so this is an upper bound and not a count — bare flats get none at all.
 */
const ATTEMPTS_PER_CELL = 4;

/**
 * Furthest a colony can reach from its centre.
 *
 * Must stay below `CELL`, or a colony could reach past the nine cells each
 * chunk examines and be clipped after all. Every radius below is clamped to it.
 */
const MAX_REACH = 26;

const COLONY_SALT = 0x0ce1a1;
const MEMBER_SALT = 0x51fe07;

const TAU = Math.PI * 2;

interface Colony {
  cellX: number;
  cellZ: number;
  index: number;
  x: number;
  z: number;
  /** Semi-axes of the ellipse, and its rotation. */
  major: number;
  minor: number;
  cos: number;
  sin: number;
  /** Bounding radius, for the cheap rejection test. */
  reach: number;
  kind: ColonyKind;
  density: number;
  /** Base hue index for the whole colony, in [0, 1). */
  hue: number;
  members: number;
  landmark: boolean;
}

/**
 * Decide whether a colony exists at cell (cellX, cellZ) slot `index`, and if so
 * what shape it is.
 *
 * Deliberately cheap: this runs nine times per attempt for every chunk built,
 * so it samples the terrain once and does no geometry work at all. Members are
 * only drawn from the generator afterwards, and only if the colony is actually
 * in range.
 */
function colonyAt(
  worldSeed: number,
  cellX: number,
  cellZ: number,
  index: number,
  terrain: Terrain,
): Colony | null {
  const rng = chunkRng(worldSeed, cellX, cellZ, COLONY_SALT + index * 0x9e37);

  const x = (cellX + rng()) * CELL;
  const z = (cellZ + rng()) * CELL;
  const density = terrain.reefDensityAt(x, z);

  // Rubble is deliberately the smallest share. Loose rock is the highest-
  // contrast thing on the seabed and reads from much further away than coral
  // does, so an even split by count is nothing like an even split by what the
  // eye actually picks up.
  const roll = rng();
  const kind =
    roll < 0.48 ? ColonyKind.Reef : roll < 0.79 ? ColonyKind.KelpBed : ColonyKind.Rubble;

  // Fertility decides whether living colonies take hold at all. Rubble is the
  // exception and runs the other way: loose rock collects on the bare ground
  // between gardens, which is what keeps the flats from being truly empty.
  const chance =
    kind === ColonyKind.Rubble
      ? 0.3 + (1 - density) * 0.34
      : kind === ColonyKind.KelpBed
        ? density * 0.9
        : density * 0.95;

  if (rng() > chance) return null;

  let major: number;
  let aspect: number;
  let perArea: number;

  switch (kind) {
    case ColonyKind.Reef:
      major = randRange(rng, 9, 21) * (0.6 + density * 0.5);
      // Reefs are roundish — they grow outward from a founder in all directions.
      aspect = randRange(rng, 0.6, 1);
      perArea = 0.034;
      break;
    case ColonyKind.KelpBed:
      major = randRange(rng, 10, 24) * (0.6 + density * 0.5);
      // Beds stretch out along the ground, so they are markedly elongated.
      aspect = randRange(rng, 0.28, 0.62);
      perArea = 0.032;
      break;
    default:
      major = randRange(rng, 6, 15);
      aspect = randRange(rng, 0.45, 1);
      perArea = 0.022;
      break;
  }

  major = Math.min(major, MAX_REACH);
  const minor = major * aspect;

  const angle = rng() * TAU;
  const area = Math.PI * major * minor;
  // Capped, because colonies overlap: where the fertility field peaks, three or
  // four can land on the same ground, and the chunk underneath them is what
  // sets the worst frame the streaming budget ever has to absorb.
  const members = Math.min(
    40,
    Math.max(3, Math.round(area * perArea * (0.65 + density * 0.6))),
  );

  // A large coral head is the thing that makes a reef read as a place rather
  // than a patch. Only fertile reefs grow one, so they stay special.
  const landmark =
    kind === ColonyKind.Reef && density > 0.45 && rng() < 0.75;

  return {
    cellX,
    cellZ,
    index,
    x,
    z,
    major,
    minor,
    cos: Math.cos(angle),
    sin: Math.sin(angle),
    reach: major,
    kind,
    density,
    hue: rng(),
    members,
    landmark,
  };
}

/** Which kind of prop a member of this colony turns out to be. */
function propFor(kind: ColonyKind, roll: number): PropKind {
  switch (kind) {
    case ColonyKind.Reef:
      // Mostly coral, with kelp at the fringe and rubble round the base. A
      // single-species cluster looks planted; a mixed one looks grown.
      if (roll < 0.7) return PropKind.Coral;
      if (roll < 0.84) return PropKind.Kelp;
      return PropKind.Rock;
    case ColonyKind.KelpBed:
      if (roll < 0.8) return PropKind.Kelp;
      if (roll < 0.92) return PropKind.Coral;
      return PropKind.Rock;
    default:
      if (roll < 0.78) return PropKind.Rock;
      if (roll < 0.9) return PropKind.Coral;
      return PropKind.Kelp;
  }
}

function sizeFor(rng: Rng, prop: PropKind, edge: number, density: number): number {
  switch (prop) {
    case PropKind.Coral:
      // Smaller toward the rim: the edge of a colony is its newest growth.
      return randRange(rng, 0.75, 1.7) * (1 - edge * 0.4) * (0.85 + density * 0.45);
    case PropKind.Kelp:
      return randRange(rng, 0.75, 1.5) * (1 - edge * 0.3);
    default:
      return randRange(rng, 0.6, 2.5) * (1 - edge * 0.25);
  }
}

/**
 * Draw one colony's members. Must be a pure function of the colony, because two
 * neighbouring chunks both call it and have to agree exactly.
 */
function expand(worldSeed: number, colony: Colony, out: ColonyMember[]): void {
  const rng = chunkRng(
    worldSeed,
    colony.cellX,
    colony.cellZ,
    MEMBER_SALT + colony.index * 0x85eb,
  );

  const emit = (
    t: number,
    angle: number,
    prop: PropKind,
    size: number,
    spread: number,
  ) => {
    // Parametric radius `t` scales both axes, so members follow the ellipse.
    const lx = Math.cos(angle) * t * colony.major;
    const lz = Math.sin(angle) * t * colony.minor;
    out.push({
      x: colony.x + lx * colony.cos - lz * colony.sin,
      z: colony.z + lx * colony.sin + lz * colony.cos,
      prop,
      edge: t,
      size,
      variant: rng(),
      spin: rng(),
      // Members share the colony's hue with only a little drift, so a cluster
      // is one or two colours rather than a rainbow — the way a single species
      // spreading across a patch of reef actually looks.
      tint: (colony.hue + (rng() - 0.5) * spread + 1) % 1,
      shade: rng(),
    });
  };

  if (colony.landmark) {
    emit(
      randRange(rng, 0, 0.12),
      rng() * TAU,
      PropKind.Structure,
      randRange(rng, 1, 1.75) * (0.8 + colony.density * 0.5),
      0.1,
    );
    // Occasionally a second, smaller head off to one side. Two structures read
    // as an outcrop; three or more starts to look like a set piece.
    if (rng() < 0.38) {
      emit(
        randRange(rng, 0.22, 0.5),
        rng() * TAU,
        PropKind.Structure,
        randRange(rng, 0.7, 1.15) * (0.8 + colony.density * 0.5),
        0.1,
      );
    }
  } else if (colony.kind === ColonyKind.Rubble && rng() < 0.55) {
    // A rubble field usually has one boulder that broke off something bigger.
    emit(randRange(rng, 0, 0.2), rng() * TAU, PropKind.Rock, randRange(rng, 2.6, 4.4), 0.4);
  }

  for (let i = 0; i < colony.members; i++) {
    // Centre-weighted: `sqrt` would spread members evenly over the ellipse, and
    // an evenly filled disc is just the sprinkle again at a smaller scale. A
    // higher exponent packs them toward the heart and thins them at the rim,
    // so the colony has a visible core and a soft edge.
    const t = Math.pow(rng(), 0.82);
    const prop = propFor(colony.kind, rng());
    emit(t, rng() * TAU, prop, sizeFor(rng, prop, t, colony.density), 0.22);
  }
}

/**
 * Every colony member that falls inside chunk (cx, cz), plus the colonies
 * centred there.
 */
export function collectColonies(
  worldSeed: number,
  cx: number,
  cz: number,
  terrain: Terrain,
): ColonyField {
  const members: ColonyMember[] = [];
  const sites: ColonySite[] = [];

  const minX = cx * CELL;
  const minZ = cz * CELL;
  const maxX = minX + CELL;
  const maxZ = minZ + CELL;

  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cellX = cx + dx;
      const cellZ = cz + dz;

      for (let index = 0; index < ATTEMPTS_PER_CELL; index++) {
        const colony = colonyAt(worldSeed, cellX, cellZ, index, terrain);
        if (!colony) continue;

        // Bounding-box rejection before any member is generated. This is what
        // keeps examining nine cells cheap: in a typical chunk most colonies
        // are thrown away here, having cost one terrain sample each.
        if (
          colony.x + colony.reach < minX ||
          colony.x - colony.reach > maxX ||
          colony.z + colony.reach < minZ ||
          colony.z - colony.reach > maxZ
        ) {
          continue;
        }

        if (dx === 0 && dz === 0) {
          sites.push({
            key: `colony:${cellX}:${cellZ}:${index}`,
            x: colony.x,
            z: colony.z,
            kind: colony.kind,
            landmark: colony.landmark,
          });
        }

        const start = members.length;
        expand(worldSeed, colony, members);

        // Keep only what landed in this chunk. The rest belong to a neighbour,
        // which will generate this same colony and reach the same conclusion.
        let kept = start;
        for (let i = start; i < members.length; i++) {
          const member = members[i]!;
          if (member.x < minX || member.x >= maxX) continue;
          if (member.z < minZ || member.z >= maxZ) continue;
          members[kept++] = member;
        }
        members.length = kept;
      }
    }
  }

  return { members, sites };
}
