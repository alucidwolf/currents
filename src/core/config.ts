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
  /** Exponential fog density. Higher = murkier, shorter draw distance. */
  fogDensity: 0.0135,
  /** Fog/ambient tint just under the surface. */
  shallowColor: 0x2e8fa8,
  /** Fog/ambient tint down at the seabed. */
  deepColor: 0x06263f,
  /** Depth over which shallow blends to deep. */
  tintDepth: 44,
  /** Hemisphere light's downward colour. Too dark here and flanks go black. */
  groundColor: 0x1a3243,
  sunColor: 0xfff3d6,
  /**
   * Three's lights are physical by default, so these sum to something close to
   * "one sun plus bounce". Pushing the total much past ~1.7 clips the pale
   * undersides to flat white and destroys the countershading entirely.
   */
  sunIntensity: 1.0,
  ambientIntensity: 0.62,
  /** Dim counter-light so side-on surfaces are not silhouettes. */
  fillColor: 0x4e8ba8,
  fillIntensity: 0.28,
} as const;

export const SWIM = {
  /** Baseline cruise speed, world units per second. */
  cruiseSpeed: 6.4,
  /** Fractional slow sine applied to cruise speed so it is not metronomic. */
  speedBreathAmount: 0.12,
  speedBreathPeriod: 16,
  /** Maximum turn rate under player control, radians/sec. */
  playerTurnRate: 0.95,
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
   * How far off the current heading the meander asks for, in radians.
   *
   * This interacts with `wanderTurnRate`: if the requested offset is larger
   * than the turn rate can deliver, the animal is pinned at full lock and
   * traces a circle. Keeping it comfortably under that ceiling is what lets it
   * hold a course and actually cover ground.
   */
  meanderStrength: 0.55,
  /** Time-domain frequency of the meander noise. Lower = longer, lazier arcs. */
  yawNoiseFrequency: 0.045,
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
  startPitch: 0.26,
  minPitch: -1.1,
  maxPitch: 1.25,
  /** Mouse sensitivity for left-drag orbiting. */
  dragSensitivity: 0.0062,
  /** Seconds of lag as the rig trails the swimmer through turns. Higher = lazier. */
  followLag: 0.55,
  /** Idle orbital drift — the screensaver camera. */
  idleDelay: 20,
  idleDriftSpeed: 0.035,
  idleEnabled: true,
} as const;

export const RENDER = {
  /** Retina is not worth the fill rate here. */
  maxPixelRatio: 1.5,
  /** A long frame (tab switch, GC pause) must not teleport anything. */
  maxDelta: 0.1,
} as const;
