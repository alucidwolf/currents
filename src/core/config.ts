/**
 * Every tunable in one place. If a magic number matters, it lives here.
 */

export const WORLD = {
  /** Side length of one terrain chunk, in world units. */
  chunkSize: 64,
  /** Quads per chunk edge. 48 -> 2401 verts per chunk, ~1.3m per quad. */
  chunkRes: 48,
  /** Chunks kept live in each direction around the swimmer. */
  chunkRadius: 3,
  /** Water surface sits at y = 0; the seabed is carved below it. */
  surfaceY: 0,
  /** Mean seabed depth below the surface. */
  seabedY: -46,
  /** Peak-to-trough terrain relief. */
  terrainAmplitude: 17,
  /** Lower = broader, lazier hills. */
  terrainFrequency: 0.0075,
  terrainOctaves: 5,
  /** How deep the winding canyons cut below the surrounding floor. */
  trenchDepth: 34,
  /** How high raised reef structures stand above it. */
  moundHeight: 24,
  /**
   * Reference span used to colour the floor by elevation, measured from the
   * mean seabed. Too wide and the ordinary floor lands in the middle of the
   * ramp as uniform silt — which is dangerously close to the fog colour and
   * makes the seabed disappear. These are sized so typical ground reads as
   * sand, with only genuine trench beds going dark.
   */
  colorSpanBelow: 30,
  colorSpanAbove: 26,
} as const;

export const WATER = {
  /**
   * Exponential fog density. Higher = murkier, shorter draw distance.
   *
   * Loosened from the original murk: the art direction wants long, clear
   * sightlines with colour doing the depth cueing, not a wall of haze.
   */
  fogDensity: 0.0084,
  /** Fog/ambient tint just under the surface. */
  shallowColor: 0x33b6cd,
  /**
   * Fog/ambient tint down at the seabed.
   *
   * Deliberately a saturated blue rather than near-black. Depth should read as
   * *bluer*, not as darker — the moment the far distance goes to black the
   * whole scene reads as murky instead of deep.
   */
  deepColor: 0x14547e,
  /**
   * Depth over which shallow blends to deep.
   *
   * Generous, so ordinary cruising depth stays in the vivid part of the ramp.
   * Tightening this drags the everyday view toward the deep tone and the
   * scene loses its colour well before it has any reason to.
   */
  tintDepth: 72,
  /** Hemisphere light's downward colour. Too dark here and flanks go black. */
  groundColor: 0x2a5f77,
  /**
   * Snell's window: the bright disc of sky you see looking straight up.
   *
   * Underwater the surface is not one even sheet. Past about 48 degrees from
   * vertical the water total-internally reflects, so the ceiling stops being a
   * window and becomes a mirror showing the dark depths back at you. That is
   * what separates "the surface" from "the distance" to the eye — without it
   * both are the same pale wash and the ceiling has no edge anywhere.
   */
  surfaceGlow: 0xf2fdff,
  /** What the mirrored part of the ceiling shows: the water below it. */
  surfaceMirror: 0x1d5f83,
  /** Cosine of the critical angle. Water to air is 1/1.333, so about 48.6°. */
  surfaceCritical: 0.661,
  /**
   * Where the ceiling starts and finishes dissolving, in metres from the eye.
   *
   * Both must sit comfortably inside the camera's far plane. The surface is a
   * finite plane, and one that simply stops draws a line across the view where
   * it does — the far clip cuts it long before its own edge, and the graded
   * water beyond the cut is not the colour the fog faded the ceiling to.
   */
  surfaceFadeNear: 110,
  surfaceFadeFar: 250,
  /**
   * The open water itself, as a vertical gradient rather than one flat colour.
   *
   * At eye level this matches the fog exactly, so distance dissolves into it
   * with no seam; above and below it departs, which is what gives the horizon a
   * position instead of leaving the whole view one continuous tint.
   */
  horizonLift: 0.42,
  horizonSink: 0.5,
  /**
   * Neutral, faintly cool. A warm sun was the hidden cause of the muddiness:
   * warm key light against cyan ambient lands on opposite sides of the wheel,
   * and the two average out to grey across every surface in the scene.
   */
  sunColor: 0xf2fbff,
  /**
   * Brightness and saturation are not the same lever, and confusing them is
   * the easy mistake here. Piling on ambient light makes everything lighter,
   * but it also drags every surface toward the ambient hue, so the whole scene
   * converges on one milky tint and the colour separation disappears.
   *
   * The bright, saturated look comes from bright *base colours* under moderate
   * light. Keep the total near 1.8; past roughly 2.3 the pale undersides clip
   * to flat white and the countershading goes with them.
   */
  sunIntensity: 0.95,
  ambientIntensity: 0.62,
  /** Counter-light so side-on surfaces are not silhouettes. */
  fillColor: 0x62b6cd,
  fillIntensity: 0.22,
  /**
   * The animal's shadow. Only it casts, so the map covers a small area around
   * the swimmer and travels with it — a frustum wide enough for the whole draw
   * distance would spread these texels far too thin to read as anything.
   */
  shadowMapSize: 1024,
  /** Half-width of the shadow frustum, in metres. Must clear the largest animal. */
  shadowExtent: 26,
  shadowSoftness: 4,
} as const;

export const SWIM = {
  /** Baseline cruise speed, world units per second. */
  cruiseSpeed: 6.4,
  /** Fractional slow sine applied to cruise speed so it is not metronomic. */
  speedBreathAmount: 0.12,
  speedBreathPeriod: 16,
  /** Maximum turn rate under player control, radians/sec. */
  playerTurnRate: 0.95,
  /**
   * How quickly arrow-key steering eases in and out, per second.
   *
   * A key is a step input: pressed, the turn would otherwise go from nothing to
   * full rate in one frame, which is precisely the jolt this whole thing is
   * meant not to have. Ramping the axis gives a turn that leans in and settles
   * out of its own accord. Higher is more responsive and more abrupt; much
   * below 2 and the animal feels like it is ignoring you.
   */
  keySteerResponse: 2.8,
  /**
   * How far off level the arrow keys can pitch the animal.
   *
   * Deliberately short of the cursor's 0.62: a held key is easy to leave held,
   * and a steep sustained climb just parks the animal against the surface.
   */
  keySteerMaxPitch: 0.46,
  /** Maximum turn rate under autopilot, radians/sec. Gentler on purpose. */
  wanderTurnRate: 0.34,
  /** How sharply the body rolls into a turn. */
  bankStrength: 1.5,
  maxBank: 0.55,
  /** Vertical bob, so it never looks rigid. */
  bobAmount: 0.28,
  bobPeriod: 6.5,
  /** Never get closer than this to the seabed or the surface. */
  seabedClearance: 4.5,
  surfaceClearance: 3.0,
} as const;

export const WANDER = {
  /**
   * Subtle wobble around the held course, in radians, and how fast it varies.
   *
   * This is the only *continuous* steering input. It has to stay small: a
   * wandering offset applied to the current heading is a turn-rate command, not
   * a heading, so any lasting offset keeps the animal turning for as long as it
   * lasts. That is what made a watched animal curve one way for the best part
   * of a minute at a time. Here the offset is applied to a course that holds
   * still, so it reads as drift rather than as a turn.
   */
  wobbleStrength: 0.14,
  wobbleFrequency: 0.05,
  /**
   * Seconds a course is held before the animal commits to a new one.
   *
   * Long, because the whole point is to travel somewhere rather than mill
   * about. A bigger turn extends its own settling time on top of this.
   */
  courseHoldMin: 13,
  courseHoldMax: 38,
  /**
   * Sizes of a committed course change, in radians, and how often each occurs.
   *
   * Mostly small adjustments, with the occasional decisive turn — that mix is
   * what makes a long unattended watch interesting, rather than either a
   * straight line or a constant fidget.
   */
  turnBands: [
    { share: 0.5, min: 0.12, max: 0.45 },
    { share: 0.32, min: 0.45, max: 1.05 },
    { share: 0.18, min: 1.05, max: 2.1 },
  ],
  /**
   * Radians of recent net turning at which the next turn's direction is fully
   * biased the other way, and how long that memory takes to fade.
   *
   * Without it nothing stops a run of same-way turns, and a run of those is
   * indistinguishable from the bug this replaced.
   */
  balanceSpan: 2.6,
  balanceMemory: 150,
  pitchNoiseFrequency: 0.031,
  /** Pitch authority is deliberately weaker than yaw: mostly level cruising. */
  maxPitch: 0.34,
  /** How far ahead terrain is probed for the avoidance arc. */
  lookaheadDistance: 46,
  lookaheadSamples: 4,
  /** Strength of the climb response when the seabed rises into the path. */
  avoidStrength: 2.6,
  /** Trail memory: how many recent positions repel, and how far they reach. */
  trailPoints: 30,
  /** At the calmer cruise speed this is about seven minutes of memory. */
  trailSampleInterval: 2.2,
  trailRadius: 115,
  trailStrength: 1.15,
  /** Curiosity: weak pull toward scenery, weak enough to read as coincidence. */
  curiosityStrength: 0.3,
  curiosityRadius: 130,
} as const;

export const CAMERA = {
  fov: 58,
  near: 0.1,
  /** Just past the fog — nothing beyond it is visible anyway. */
  far: 340,
  /** Orbit distance from the swimmer. */
  distance: 15,
  minDistance: 6,
  maxDistance: 52,
  /** Starting orbit offset, radians. Yaw is relative to the swimmer's heading. */
  startYaw: Math.PI,
  /**
   * Raised a little from level. Looking down at the scene rather than across it
   * is part of what makes it read as a model of a place — the reference look
   * takes that much further with a fixed isometric view, which is not open to a
   * game about following an animal, but the angle still helps.
   */
  startPitch: 0.34,
  minPitch: -1.1,
  maxPitch: 1.25,
  /** Mouse sensitivity for left-drag orbiting. */
  dragSensitivity: 0.0062,
  /** Seconds of lag as the rig trails the swimmer through turns. Higher = lazier. */
  followLag: 0.55,
  /**
   * How far the camera keeps off the seabed and out of the air.
   *
   * Orbiting down swings the camera below the animal — far enough below, at any
   * usual distance, to end up under the floor. Back faces are culled, so from
   * under the seabed you are not looking at rock, you are looking at nothing:
   * straight through the ground and out at the water beyond it.
   *
   * The floor bound is the larger because the seabed has things standing on it,
   * and because the surface only ever needs enough room not to break out into
   * air that is not rendered.
   */
  floorClearance: 2.8,
  airClearance: 1.4,
  /** Idle orbital drift — the screensaver camera. */
  idleDelay: 20,
  idleDriftSpeed: 0.035,
  idleEnabled: true,
} as const;

/**
 * The diorama look: shallow focus, a warm/cool split, and a vignette.
 *
 * Chunky low-poly forms under soft light read as a *model* of a world rather
 * than a world, and it is shallow depth of field that tells the eye how big to
 * think the scene is — the same trick that makes a tilt-shift photograph of a
 * real street look like a toy. Everything here is in metres of scene depth or
 * in linear colour, not in arbitrary units.
 */
export const DIORAMA = {
  /**
   * Blur reach in half-resolution pixels. The blur runs on a half-size copy,
   * so its effect on screen is twice this.
   */
  blurRadius: 1.4,
  /** Metres either side of the animal that stay fully sharp. */
  focusRange: 7,
  /**
   * Metres beyond that to reach maximum blur.
   *
   * Asymmetric on purpose: foreground water going soft quickly is most of the
   * toy-model effect, while distance is approached gently so the reef does not
   * dissolve the moment you stop swimming at it.
   */
  nearFalloff: 13,
  farFalloff: 85,
  /** Ceilings on each, so distance stays readable rather than becoming a smear. */
  maxNearBlur: 1,
  maxFarBlur: 0.8,
  /**
   * Split tone, added after lighting. A warm key light against this scene's
   * cool ambient averages to grey on every surface — that is how the palette
   * went muddy once before. Applied as a grade, the two pull apart instead.
   */
  warmHighlights: [0.055, 0.03, -0.014],
  coolShadows: [-0.018, 0.004, 0.032],
  /** Slightly above 1: the reference look is colourful, not merely bright. */
  saturation: 1.12,
  /** How far the corners fall off. Frames the scene as an object. */
  vignette: 0.32,
} as const;

export const RENDER = {
  /** Retina is not worth the fill rate here. */
  maxPixelRatio: 1.5,
  /** A long frame (tab switch, GC pause) must not teleport anything. */
  maxDelta: 0.1,
} as const;
