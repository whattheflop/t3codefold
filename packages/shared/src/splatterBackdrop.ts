/**
 * The splatter backdrop behind the chat canvas, rendered from theme colours.
 *
 * Geometry is grown once from a seeded RNG and cached as colourless markup;
 * colour, intensity and glow are applied at render time by wrapping that
 * markup in <use> references. Re-rendering for a new theme or a settings drag
 * is therefore string assembly, not geometry, and the same art renders
 * identically on web and mobile.
 *
 * Bloom and glow are baked radial gradients and stroke halos, never SVG
 * filters: filters re-rasterize expensively on mobile GPUs, and not every
 * platform SVG decoder supports them.
 */

export type SplatterAppearance = "light" | "dark";
export type SplatterOklch = { readonly l: number; readonly c: number; readonly h: number };

/* ------------------------------------------------------------------ rng -- */

type Random = {
  (): number;
  /** Roughly normal, for angles and sizes that should cluster around a value. */
  gauss: (mean: number, deviation: number) => number;
  range: (min: number, max: number) => number;
  /** Heavily biased toward `min`; the reason most droplets read as fine mist. */
  skewed: (min: number, max: number, power: number) => number;
};

function makeRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const random = next as Random;
  random.range = (min, max) => min + next() * (max - min);
  random.skewed = (min, max, power) => min + next() ** power * (max - min);
  random.gauss = (mean, deviation) =>
    mean + ((next() + next() + next() + next() - 2) / 2) * deviation * 2;
  return random;
}

/* -------------------------------------------------------------- shapes -- */

type Point = readonly [number, number];

const round = (n: number) => Math.round(n * 10) / 10;
/** Whole units, for the overspray: at these sizes the lost tenth is invisible
 *  and there are enough particles for the saved digits to matter. */
const coarse = (n: number) => Math.round(n);
const pt = (p: Point) => `${round(p[0])} ${round(p[1])}`;

/** Closed Catmull-Rom spline through the points, emitted as cubic Béziers. */
function closedSpline(points: ReadonlyArray<Point>): string {
  const at = (i: number) => points[((i % points.length) + points.length) % points.length]!;
  let d = `M${pt(at(0))}`;
  for (let i = 0; i < points.length; i += 1) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return `${d}Z`;
}

/**
 * An impact mass. The radius is summed sine harmonics rather than per-point
 * jitter: low harmonics carve the deep asymmetric bays that make a splat read
 * as paint, and high ones only ripple the edge. Stretching along `throw` keeps
 * every mass agreeing about which way the paint was travelling.
 */
function mass(
  cx: number,
  cy: number,
  radius: number,
  throwAngle: number,
  stretch: number,
  random: Random,
): string {
  const harmonics = [1, 2, 3, 5, 8, 13].map((frequency, index) => ({
    frequency,
    amplitude: [0.26, 0.19, 0.15, 0.11, 0.08, 0.05][index]! * random.range(0.5, 1.45),
    phase: random() * Math.PI * 2,
  }));
  const steps = Math.min(32, Math.max(14, Math.round(12 + radius * 0.5)));
  const points: Array<Point> = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    const wobble = harmonics.reduce(
      (sum, h) => sum + h.amplitude * Math.sin(h.frequency * angle + h.phase),
      0,
    );
    const elongation = 1 + stretch * Math.cos(angle - throwAngle) ** 2;
    const r = radius * Math.max(0.3, 1 + wobble) * elongation;
    points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  return closedSpline(points);
}

/**
 * A ray of paint flicked off the mass: hair-thin, curved, tapering to nothing.
 * Width is a fraction of a percent of the cluster box, which is what separates
 * a flick from the triangular spike a naive taper produces.
 */
function ray(
  cx: number,
  cy: number,
  rimAngle: number,
  inner: number,
  length: number,
  width: number,
  random: Random,
): { path: string; tip: Point; width: number } {
  // Rays leave the rim on their own heading. Firing every ray straight out from
  // the centre lines them all up and the splat reads as a star, not as paint.
  const originX = cx + Math.cos(rimAngle) * inner;
  const originY = cy + Math.sin(rimAngle) * inner;
  const angle = rimAngle + random.gauss(0, 0.32);
  const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
  const [nx, ny] = [-dy, dx];
  const bend = random.gauss(0, length * 0.3);
  const along = (t: number, offset: number): Point => [
    originX + dx * (length * t) + nx * (bend * t * t + offset),
    originY + dy * (length * t) + ny * (bend * t * t + offset),
  ];
  const tip = along(1, 0);
  return {
    // Both flanks bow with the same bend, so the ray curves instead of fanning.
    path:
      `M${pt(along(0, width))}` +
      `Q${pt(along(0.55, width * 0.42))} ${pt(tip)}` +
      `Q${pt(along(0.55, -width * 0.42))} ${pt(along(0, -width))}Z`,
    tip,
    width,
  };
}

type Drop = { cx: number; cy: number; rx: number; ry: number; angle: number };

/** One throw of paint: mass, satellites, rays, and the mist that outran them. */
function splatter(cx: number, cy: number, radius: number, random: Random) {
  const throwAngle = random() * Math.PI * 2;
  const paths: Array<string> = [mass(cx, cy, radius, throwAngle, random.range(0.1, 0.32), random)];
  const drops: Array<Drop> = [];

  // A second mass inside the first. Fills in one group composite against each
  // other, so the overlap alone gives the splat a denser centre without a
  // separate opacity pass.
  paths.push(
    mass(
      cx + Math.cos(throwAngle) * radius * random.range(0.1, 0.34),
      cy + Math.sin(throwAngle) * radius * random.range(0.1, 0.34),
      radius * random.range(0.42, 0.66),
      throwAngle,
      random.range(0.1, 0.45),
      random,
    ),
  );

  // Satellite masses sit forward of the impact, the way a thrown blob breaks up.
  for (let i = 0; i < 2 + Math.floor(random() * 2); i += 1) {
    const angle = random.gauss(throwAngle, 0.8);
    const reach = radius * random.range(0.85, 2.1);
    paths.push(
      mass(
        cx + Math.cos(angle) * reach,
        cy + Math.sin(angle) * reach,
        radius * random.range(0.14, 0.36),
        angle,
        random.range(0.2, 0.7),
        random,
      ),
    );
  }

  for (let i = 0; i < 6 + Math.floor(random() * 6); i += 1) {
    // Most rays follow the throw; the occasional straggler goes anywhere, which
    // is what stops the result from reading as a radially symmetric burst.
    const angle = random() < 0.75 ? random.gauss(throwAngle, 0.9) : random() * Math.PI * 2;
    const flick = ray(
      cx,
      cy,
      angle,
      radius * random.range(0.6, 1.05),
      radius * random.skewed(0.5, 3.0, 2),
      radius * random.range(0.014, 0.05),
      random,
    );
    paths.push(flick.path);
    if (random() < 0.35) {
      const bead = flick.width * random.range(1.1, 2.2);
      drops.push({ cx: flick.tip[0], cy: flick.tip[1], rx: bead, ry: bead, angle: 0 });
    }
  }

  for (let i = 0; i < 95 + Math.floor(random() * 65); i += 1) {
    const angle = random() < 0.7 ? random.gauss(throwAngle, 1.15) : random() * Math.PI * 2;
    const reach = radius * random.skewed(1.0, 4.6, 1.5);
    const size = radius * random.skewed(0.006, 0.11, 2.8);
    drops.push({
      cx: cx + Math.cos(angle) * reach,
      cy: cy + Math.sin(angle) * reach,
      // Airborne paint stretches along its own flight path.
      rx: size * random.range(1.0, 1.9),
      ry: size,
      angle: (angle * 180) / Math.PI,
    });
  }

  // Atomized haze: the fine particles that drift well past the mist and never
  // resolve into shapes. Sized in absolute units rather than as a fraction of
  // the splat, so spray from a big throw is no coarser than from a small one --
  // which is what makes the whole cluster read as one sprayed surface.
  const haze: Array<Drop> = [];
  for (let i = 0; i < Math.round(radius * 1.7); i += 1) {
    const angle = random() < 0.62 ? random.gauss(throwAngle, 1.35) : random() * Math.PI * 2;
    const reach = radius * random.skewed(1.2, 7.5, 2.1);
    const size = random.skewed(0.3, 1.9, 2.5);
    haze.push({
      cx: cx + Math.cos(angle) * reach,
      cy: cy + Math.sin(angle) * reach,
      rx: size,
      ry: size,
      angle: 0,
    });
  }

  return { paths, drops, haze };
}

/* ------------------------------------------------------------- artwork -- */

/** Placement is in fractions of the cluster box, so a corner reads the same at any size. */
type Placement = { x: number; y: number; radius: number; hue: number; seed: number };

const SIZE = 600;

const CLUSTERS: Record<"a" | "b", ReadonlyArray<Placement>> = {
  a: [
    { x: 0.8, y: 0.14, radius: 42, hue: 0, seed: 0x5eed07 },
    { x: 0.52, y: 0.33, radius: 24, hue: 0, seed: 0x5eed02 },
    { x: 0.92, y: 0.52, radius: 17, hue: 1, seed: 0x5eed23 },
    { x: 0.63, y: 0.05, radius: 14, hue: 0, seed: 0x5eed61 },
    { x: 0.66, y: 0.66, radius: 11, hue: 0, seed: 0x5eed14 },
    { x: 0.21, y: 0.29, radius: 10, hue: 0, seed: 0x5eed62 },
    { x: 0.34, y: 0.62, radius: 8, hue: 0, seed: 0x5eed36 },
    { x: 0.87, y: 0.8, radius: 7, hue: 0, seed: 0x5eed63 },
    { x: 0.44, y: 0.47, radius: 6, hue: 1, seed: 0x5eed64 },
    { x: 0.58, y: 0.87, radius: 6, hue: 2, seed: 0x5eed05 },
    { x: 0.11, y: 0.71, radius: 5, hue: 0, seed: 0x5eed65 },
    { x: 0.75, y: 0.38, radius: 4, hue: 0, seed: 0x5eed66 },
  ],
  b: [
    { x: 0.22, y: 0.84, radius: 46, hue: 0, seed: 0x5eed31 },
    { x: 0.53, y: 0.63, radius: 23, hue: 0, seed: 0x5eed12 },
    { x: 0.07, y: 0.47, radius: 16, hue: 1, seed: 0x5eed43 },
    { x: 0.42, y: 0.95, radius: 14, hue: 0, seed: 0x5eed71 },
    { x: 0.78, y: 0.88, radius: 12, hue: 0, seed: 0x5eed24 },
    { x: 0.71, y: 0.44, radius: 10, hue: 0, seed: 0x5eed72 },
    { x: 0.33, y: 0.38, radius: 8, hue: 0, seed: 0x5eed56 },
    { x: 0.14, y: 0.16, radius: 7, hue: 0, seed: 0x5eed73 },
    { x: 0.88, y: 0.66, radius: 6, hue: 1, seed: 0x5eed74 },
    { x: 0.62, y: 0.3, radius: 6, hue: 2, seed: 0x5eed15 },
    { x: 0.37, y: 0.17, radius: 5, hue: 0, seed: 0x5eed75 },
    { x: 0.05, y: 0.68, radius: 4, hue: 0, seed: 0x5eed76 },
  ],
};

/* -------------------------------------------------------------- colour -- */

function oklchToLinearRgb({ l, c, h }: SplatterOklch): [number, number, number] {
  const hue = (h * Math.PI) / 180;
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

/**
 * The most saturated in-gamut colour at this lightness and hue. Clamping an
 * out-of-gamut colour's channels instead would bend its hue, which a hue
 * picker notices as its value jumping on the next read.
 */
export function fitOklchToGamut(color: SplatterOklch): SplatterOklch {
  const inGamut = (c: number) =>
    oklchToLinearRgb({ ...color, c }).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  if (inGamut(color.c)) return color;
  let low = 0;
  let high = color.c;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (inGamut(mid)) low = mid;
    else high = mid;
  }
  return { ...color, c: low };
}

export function oklchToHex(color: SplatterOklch): string {
  const channels = oklchToLinearRgb(color);
  return `#${channels
    .map((v) => {
      const srgb = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055;
      return Math.round(Math.min(1, Math.max(0, srgb)) * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

/** Inverse of oklchToHex, for starting a hue picker from a stored colour. */
export function hexToOklch(hex: string): SplatterOklch | null {
  if (!isSplatterHexColor(hex)) return null;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const l = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const h = (Math.atan2(bb, a) * 180) / Math.PI;
  return { l, c: Math.hypot(a, bb), h: h < 0 ? h + 360 : h };
}

/** Reads the canonical `oklch(L C H)` form theme palettes are stored in. */
export function parseOklch(value: string | null | undefined): SplatterOklch | null {
  const match = value?.trim().match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i);
  if (!match) return null;
  const l = Number(match[1]) / (match[2] ? 100 : 1);
  const c = Number(match[3]);
  const h = Number(match[4]);
  return [l, c, h].every(Number.isFinite) ? { l, c, h } : null;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const isSplatterHexColor = (value: unknown): value is string =>
  typeof value === "string" && HEX_COLOR.test(value);

const hueGap = (a: number, b: number) => {
  const gap = Math.abs(a - b) % 360;
  return gap > 180 ? 360 - gap : gap;
};

/**
 * Three paint colours from a theme's accent and action colours.
 *
 * The accent leads. The action colour is second when it is a distinct hue,
 * otherwise a neighbour of the accent stands in. The third, used sparingly, is
 * the accent's near-complement, which is what gives Cyberpunk its magenta.
 * Lightness and chroma are then pulled to values that read as paint on that
 * appearance's canvas, so a muted theme still gets visible splatter. A
 * near-grey accent stays grey: a monochrome theme gets monochrome paint.
 */
export function deriveSplatterColors(
  accent: SplatterOklch | null,
  action: SplatterOklch | null,
  appearance: SplatterAppearance,
): readonly [string, string, string] {
  const lead = accent ?? { l: 0.7, c: 0.18, h: 330 };
  const second = action && hueGap(action.h, lead.h) > 20 ? action : { ...lead, h: lead.h + 45 };
  const third = { ...lead, h: (lead.h + 190) % 360 };
  const achromatic = lead.c < 0.03;
  const tune = (color: SplatterOklch) => tuneSplatterPaint(color, appearance, achromatic);
  return [tune(lead), tune(second), tune(third)];
}

/**
 * A colour pulled to the lightness and chroma that read as paint on this
 * appearance's canvas, keeping its hue. Achromatic paint stays grey.
 */
export function tuneSplatterPaint(
  color: SplatterOklch,
  appearance: SplatterAppearance,
  achromatic = color.c < 0.03,
): string {
  return oklchToHex({
    l: appearance === "dark" ? 0.86 : 0.58,
    c: achromatic ? 0 : Math.min(appearance === "dark" ? 0.27 : 0.2, Math.max(0.13, color.c * 1.1)),
    h: color.h,
  });
}

/* -------------------------------------------------------------- render -- */

export interface SplatterRenderOptions {
  /** Hex paint colours: lead, second, rare accent. */
  readonly colors: readonly [string, string, string];
  readonly appearance: SplatterAppearance;
  /** Multiplier on every alpha; 1 is the tuned default. */
  readonly intensity: number;
  /** Neon mode: stronger bloom and a stroke halo around every mark. */
  readonly glow: boolean;
  /** Pattern variant; 0 is the original art. */
  readonly seed: number;
  /** Multiplier on how many marks the field scatters; 1 is the tuned default, 0 leaves only the corner clusters. */
  readonly amount: number;
}

const BASE_ALPHA = {
  dark: { paint: 0.11, glow: 0.08, haze: 0.6 },
  light: { paint: 0.14, glow: 0.07, haze: 0.55 },
} as const;

type SplatMarkup = {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly hue: number;
  readonly marks: string;
  readonly haze: string;
};

/** Colourless field markup, one entry per paint colour. */
type FieldMarkup = {
  readonly marks: readonly [string, string, string];
  readonly haze: readonly [string, string, string];
  /** Path data for the spray grain, one path per colour. */
  readonly grain: readonly [string, string, string];
};

/**
 * One grain of spray as a tiny square subpath. At a pixel or two a square
 * rasterizes the same as a circle, and a few thousand of these as path
 * commands cost a fraction of the bytes of as many <circle> elements.
 */
const grainMarkup = (x: number, y: number, size: number) => {
  const side = round(size);
  return `M${coarse(x)} ${coarse(y)}h${side}v${side}h-${side}z`;
};

/** Enough for the live seed's three layers plus the seed being dragged to. */
const MARKUP_CACHE_LIMIT = 8;
const markupCache = new Map<string, unknown>();

/** Grows markup on first use and reuses it after; geometry never depends on colour. */
function cachedMarkup<T>(key: string, grow: () => T): T {
  if (markupCache.has(key)) return markupCache.get(key) as T;
  const markup = grow();
  // Oldest out first: a Map iterates in insertion order.
  if (markupCache.size >= MARKUP_CACHE_LIMIT) markupCache.delete(markupCache.keys().next().value!);
  markupCache.set(key, markup);
  return markup;
}

/**
 * Where a splat lands for a given user seed. Seed 0 is the original art,
 * untouched. Any other seed moves each splat a little and rescales it, but
 * only a little: far enough that the pattern reads as new, near enough that
 * the corner clusters keep the centre column clear on every seed.
 */
function placementFor(spec: Placement, seed: number): Placement {
  if (seed === 0) return spec;
  const random = makeRandom(Math.imul(spec.seed, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca6b));
  return {
    x: Math.min(0.95, Math.max(0.05, spec.x + (random() - 0.5) * 0.16)),
    y: Math.min(0.95, Math.max(0.05, spec.y + (random() - 0.5) * 0.16)),
    radius: spec.radius * (0.8 + random() * 0.4),
    hue: spec.hue,
    seed: (spec.seed ^ Math.imul(seed, 0x27d4eb2f)) >>> 0,
  };
}

const hazeMarkup = (d: Drop) =>
  `<circle cx="${coarse(d.cx)}" cy="${coarse(d.cy)}" r="${round(d.rx)}"/>`;

function dropMarkup(d: Drop): string {
  if (d.rx < 0.8) return `<circle cx="${coarse(d.cx)}" cy="${coarse(d.cy)}" r="${round(d.ry)}"/>`;
  const at = `cx="${round(d.cx)}" cy="${round(d.cy)}"`;
  if (Math.abs(d.rx - d.ry) < 0.05) return `<circle ${at} r="${round(d.rx)}"/>`;
  return (
    `<ellipse ${at} rx="${round(d.rx)}" ry="${round(d.ry)}" ` +
    `transform="rotate(${round(d.angle)} ${round(d.cx)} ${round(d.cy)})"/>`
  );
}

/** Colourless markup for one cluster and seed. */
function clusterMarkup(cluster: "a" | "b", seed: number): ReadonlyArray<SplatMarkup> {
  return cachedMarkup(`${cluster}:${seed}`, () =>
    CLUSTERS[cluster].map((base) => {
      const spec = placementFor(base, seed);
      const cx = spec.x * SIZE;
      const cy = spec.y * SIZE;
      const { paths, drops, haze } = splatter(cx, cy, spec.radius, makeRandom(spec.seed));
      return {
        x: cx,
        y: cy,
        radius: spec.radius,
        hue: spec.hue,
        haze: haze.map(hazeMarkup).join(""),
        marks: paths.map((d) => `<path d="${d}"/>`).join("") + drops.map(dropMarkup).join(""),
      };
    }),
  );
}

/**
 * The field's frame. It is painted with `cover`, so a screen of any shape
 * crops it rather than stretching it, and it grows with the screen: a 4K
 * canvas gets the same composition as a laptop, not a laptop's worth of paint
 * marooned in two corners.
 */
const FIELD_WIDTH = 1600;
const FIELD_HEIGHT = 1000;

/** Mostly the lead paint, some second, a rare accent, like the clusters. */
const pickHue = (random: Random) => {
  const roll = random();
  return roll < 0.62 ? 0 : roll < 0.9 ? 1 : 2;
};

/** Field marks at an amount of 1; the amount setting scales every count. */
const FIELD_THROWS = 18;
const FIELD_BURSTS = 16;
const FIELD_GRAIN = 1400;

/**
 * Where the nth mark of a kind lands, from the R2 low-discrepancy sequence:
 * each new point falls in the biggest gap left so far, so raising the amount
 * fills the canvas evenly instead of clumping. `offset` varies it per seed.
 */
const spreadPoint = (index: number, offset: number): Point => [
  (0.5 + (index + offset) * 0.7548776662) % 1,
  (0.5 + (index + offset) * 0.569840291) % 1,
];

/**
 * Paint flung across the whole canvas, between the two corner clusters:
 * small throws, bursts of fine spray, and loose grain over all of it. It is
 * sparser than the clusters and thins through the centre column, so it reads
 * as the same canvas worked over rather than a pattern behind the text.
 *
 * Every mark grows from its own random stream, keyed by seed, kind and index,
 * so changing `amount` adds or removes marks at the end of each run and never
 * reshuffles the ones already on screen.
 */
function fieldMarkup(seed: number, amount: number): FieldMarkup {
  return cachedMarkup(`field:${seed}:${amount}`, () => {
    const streamFor = (kind: number, index: number) =>
      makeRandom(
        (Math.imul(seed + 1, 0x9e3779b1) ^
          Math.imul(kind, 0x85ebca6b) ^
          Math.imul(index + 1, 0xc2b2ae35)) >>>
          0,
      );
    const offset = (seed * 7919) % 10007;
    const count = (base: number) => Math.round(base * Math.max(0, amount));
    const marks: [Array<string>, Array<string>, Array<string>] = [[], [], []];
    const haze: [Array<string>, Array<string>, Array<string>] = [[], [], []];
    const grain: [Array<string>, Array<string>, Array<string>] = [[], [], []];
    const central = (x: number) => Math.abs(x / FIELD_WIDTH - 0.5) < 0.2;

    // Small throws.
    for (let i = 0; i < count(FIELD_THROWS); i += 1) {
      const random = streamFor(1, i);
      const [u, v] = spreadPoint(i, offset);
      const x = (u + random.range(-0.03, 0.03)) * FIELD_WIDTH;
      const y = (v + random.range(-0.03, 0.03)) * FIELD_HEIGHT;
      if (central(x) && random() < 0.65) continue;
      const hue = pickHue(random);
      const splat = splatter(x, y, random.skewed(2, 18, 2.8), random);
      marks[hue].push(
        ...splat.paths.map((d) => `<path d="${d}"/>`),
        ...splat.drops.map(dropMarkup),
      );
      haze[hue].push(...splat.haze.map(hazeMarkup));
    }

    // Spray bursts: a fan of fine grain flung from one point, dense where the
    // paint left the nozzle and thinning toward the edge of the cone, with the
    // odd heavier droplet. Grain is scattered, never strung along a path, so a
    // burst reads as airbrushed texture rather than a dotted line.
    for (let i = 0; i < count(FIELD_BURSTS); i += 1) {
      const random = streamFor(2, i);
      const [u, v] = spreadPoint(i, offset + 5003);
      const [originX, originY] = [u * FIELD_WIDTH, v * FIELD_HEIGHT];
      if (central(originX) && random() < 0.5) continue;
      const hue = pickHue(random);
      const heading = random() * Math.PI * 2;
      const spread = random.range(0.35, 1.1);
      const reach = random.range(90, 320);
      const specks = Math.round(reach * random.range(2, 3.2));
      for (let j = 0; j < specks; j += 1) {
        const angle = random.gauss(heading, spread);
        // Most paint lands near the origin; a long tail carries the fine mist.
        const distance = reach * random.skewed(0.03, 1, 1.7);
        const x = originX + Math.cos(angle) * distance;
        const y = originY + Math.sin(angle) * distance;
        if (random() < 0.025) {
          const size = random.range(1, 2.4) * (1 - (distance / reach) * 0.5);
          marks[hue].push(
            dropMarkup({
              cx: x,
              cy: y,
              rx: size * random.range(1, 1.7),
              ry: size,
              angle: (angle * 180) / Math.PI,
            }),
          );
        } else {
          grain[hue].push(grainMarkup(x, y, random.skewed(0.6, 1.6, 2.2)));
        }
      }
    }

    // Loose grain over everything, so the spaces between bursts still read
    // as a sprayed surface.
    for (let i = 0; i < count(FIELD_GRAIN); i += 1) {
      const random = streamFor(3, i);
      const x = random() * FIELD_WIDTH;
      if (central(x) && random() < 0.4) continue;
      grain[pickHue(random)].push(
        grainMarkup(x, random() * FIELD_HEIGHT, random.skewed(0.6, 1.8, 2.5)),
      );
    }

    return {
      marks: [marks[0].join(""), marks[1].join(""), marks[2].join("")],
      haze: [haze[0].join(""), haze[1].join(""), haze[2].join("")],
      grain: [grain[0].join(""), grain[1].join(""), grain[2].join("")],
    };
  });
}

/* ------------------------------------------------------------ compose -- */

const alpha = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;

function alphas(options: SplatterRenderOptions) {
  const base = BASE_ALPHA[options.appearance];
  const intensity = Math.max(0, options.intensity);
  return {
    paint: alpha(base.paint * intensity),
    haze: alpha(base.paint * base.haze * intensity),
    bloom: alpha(base.glow * intensity * (options.glow ? 2.4 : 1)),
  };
}

type Layers = { readonly defs: string; readonly body: string };

/**
 * Paint for one group of marks: its haze, the glow halos in neon mode, then
 * the marks themselves, reusing `#id` by reference.
 */
function paintLayers(
  id: string,
  color: string,
  haze: string,
  options: SplatterRenderOptions,
): string {
  const { paint, haze: hazeAlpha } = alphas(options);
  let layers = haze ? `<g fill="${color}" fill-opacity="${hazeAlpha}">${haze}</g>` : "";
  if (options.glow) {
    // Two soft rings under the paint stand in for a blur: a wide faint one
    // and a tighter brighter one.
    for (const [width, strength] of [
      [6, 0.35],
      [2.6, 0.7],
    ] as const) {
      layers +=
        `<use xlink:href="#${id}" fill="none" stroke="${color}" ` +
        `stroke-width="${width}" stroke-linejoin="round" stroke-opacity="${alpha(paint * strength)}"/>`;
    }
  }
  return `${layers}<use xlink:href="#${id}" fill="${color}" fill-opacity="${paint}"/>`;
}

/** `prefix` keeps ids unique when several layers share one document. */
function clusterLayers(cluster: "a" | "b", options: SplatterRenderOptions, prefix = ""): Layers {
  const { bloom } = alphas(options);
  const defs: Array<string> = [];
  const glows: Array<string> = [];
  const layers: Array<string> = [];
  clusterMarkup(cluster, options.seed).forEach((splat, index) => {
    const color = options.colors[splat.hue] ?? options.colors[0];
    const [gradient, marks] = [`${prefix}g${index}`, `${prefix}m${index}`];
    defs.push(
      `<radialGradient id="${gradient}">` +
        `<stop offset="0" stop-color="${color}" stop-opacity="${bloom}"/>` +
        `<stop offset=".45" stop-color="${color}" stop-opacity="${alpha(bloom * 0.4)}"/>` +
        `<stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
      `<g id="${marks}">${splat.marks}</g>`,
    );
    glows.push(
      `<circle cx="${round(splat.x)}" cy="${round(splat.y)}" ` +
        `r="${round(splat.radius * (options.glow ? 5.6 : 4.6))}" fill="url(#${gradient})"/>`,
    );
    layers.push(paintLayers(marks, color, splat.haze, options));
  });
  return { defs: defs.join(""), body: glows.join("") + layers.join("") };
}

function fieldLayers(options: SplatterRenderOptions, prefix = ""): Layers {
  const field = fieldMarkup(options.seed, options.amount);
  let defs = "";
  let body = "";
  const { paint } = alphas(options);
  field.marks.forEach((marks, hue) => {
    const id = `${prefix}f${hue}`;
    const color = options.colors[hue] ?? options.colors[0];
    defs += `<g id="${id}">${marks}</g>`;
    // Grain takes stronger paint, since a grain covers barely a pixel, but no
    // glow halos: a halo per grain would smear the texture into fog.
    if (field.grain[hue]) {
      body += `<path fill="${color}" fill-opacity="${alpha(paint * 2.6)}" d="${field.grain[hue]}"/>`;
    }
    body += paintLayers(id, color, field.haze[hue]!, options);
  });
  return { defs, body };
}

const svgDocument = (width: number, height: number, content: string, attributes = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
  `viewBox="0 0 ${width} ${height}"${attributes} fill="none">${content}</svg>`;

/** One corner cluster, square, for anchoring in a corner of the canvas. */
export function renderSplatterCluster(cluster: "a" | "b", options: SplatterRenderOptions): string {
  const { defs, body } = clusterLayers(cluster, options);
  return svgDocument(SIZE, SIZE, `<defs>${defs}</defs>${body}`);
}

/** The whole-canvas field that sits under the clusters. Paint it with `cover`. */
export function renderSplatterField(options: SplatterRenderOptions): string {
  const { defs, body } = fieldLayers(options);
  return svgDocument(
    FIELD_WIDTH,
    FIELD_HEIGHT,
    `<defs>${defs}</defs>${body}`,
    ` preserveAspectRatio="xMidYMid slice"`,
  );
}

/** One merged pull request's splat: `key` places it, `color` is hex paint. */
export type MergeSplat = { readonly key: string; readonly color: string };

/** FNV-1a, so a merge's key always lands its splat in the same place. */
function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

/** Portrait frame for phones, where the wide field would crop to its middle third. */
const COMPACT_MERGE_WIDTH = 600;
const COMPACT_MERGE_HEIGHT = 1200;

type MergeGeometry = Omit<SplatMarkup, "hue">;

/** The most splats one layer paints, newest kept, so a busy day stays cheap. */
const MAX_MERGE_SPLATS = 40;
/** A capped day of merges in both frames, with room to spare. */
const MERGE_CACHE_LIMIT = MAX_MERGE_SPLATS * 3;
const mergeGeometryCache = new Map<string, MergeGeometry>();

/**
 * Colourless markup for one merge's splat. Cached, so a new merge grows only
 * its own splat and a theme change regrows none.
 */
function mergeGeometry(key: string, compact: boolean): MergeGeometry {
  const cacheKey = `${compact ? "c" : "w"}:${key}`;
  const cached = mergeGeometryCache.get(cacheKey);
  if (cached) return cached;
  const [width, height] = compact
    ? [COMPACT_MERGE_WIDTH, COMPACT_MERGE_HEIGHT]
    : [FIELD_WIDTH, FIELD_HEIGHT];
  const random = makeRandom(hashKey(key));
  let u = random.range(0.06, 0.94);
  // Fold centre-column landings out to the sides, keeping which side they chose.
  if (!compact && Math.abs(u - 0.5) < 0.2) u += u < 0.5 ? -0.2 : 0.2;
  const x = u * width;
  const y = random.range(0.08, 0.9) * height;
  const radius = random.range(9, 20) * (compact ? 1.4 : 1);
  const { paths, drops, haze } = splatter(x, y, radius, random);
  const geometry = {
    x,
    y,
    radius,
    marks: paths.map((d) => `<path d="${d}"/>`).join("") + drops.map(dropMarkup).join(""),
    haze: haze.map(hazeMarkup).join(""),
  };
  if (mergeGeometryCache.size >= MERGE_CACHE_LIMIT) {
    mergeGeometryCache.delete(mergeGeometryCache.keys().next().value!);
  }
  mergeGeometryCache.set(cacheKey, geometry);
  return geometry;
}

/**
 * The dynamic layer: one splat per pull request merged today, each in its
 * repository's colour. Where a splat lands and how it is shaped come from
 * its key alone, so the same merge paints identically on every render and
 * device, and a new merge adds a splat without moving the others.
 *
 * Framed like the field and painted with `cover`. The wide frame keeps
 * splats out of the centre column; the compact one cannot afford to.
 */
export function renderMergeSplatters(
  splats: ReadonlyArray<MergeSplat>,
  options: SplatterRenderOptions,
  compact = false,
): string {
  const { defs, body } = mergeLayers(splats, options, compact);
  const [width, height] = mergeFrame(compact);
  return svgDocument(
    width,
    height,
    `<defs>${defs}</defs>${body}`,
    ` preserveAspectRatio="xMidYMid slice"`,
  );
}

const mergeFrame = (compact: boolean): readonly [number, number] =>
  compact ? [COMPACT_MERGE_WIDTH, COMPACT_MERGE_HEIGHT] : [FIELD_WIDTH, FIELD_HEIGHT];

function mergeLayers(
  splats: ReadonlyArray<MergeSplat>,
  options: SplatterRenderOptions,
  compact: boolean,
): Layers {
  const { bloom } = alphas(options);
  let defs = "";
  let glows = "";
  let body = "";
  // Each splat is ~10 kB of markup; the newest cap's worth is plenty of paint.
  splats.slice(-MAX_MERGE_SPLATS).forEach((splat, index) => {
    const { x, y, radius, marks, haze } = mergeGeometry(splat.key, compact);
    const [gradient, id] = [`mg${index}`, `mm${index}`];
    defs +=
      `<radialGradient id="${gradient}">` +
      `<stop offset="0" stop-color="${splat.color}" stop-opacity="${bloom}"/>` +
      `<stop offset="1" stop-color="${splat.color}" stop-opacity="0"/></radialGradient>` +
      `<g id="${id}">${marks}</g>`;
    glows += `<circle cx="${round(x)}" cy="${round(y)}" r="${round(radius * 4.6)}" fill="url(#${gradient})"/>`;
    body += paintLayers(id, splat.color, haze, options);
  });
  return { defs, body: glows + body };
}

export type SplatterFrame = { readonly x: number; readonly y: number; readonly size: number };

/**
 * Where the two square clusters sit on a canvas of this size, in its own
 * units. Mirrors the [data-chat-canvas] rules in apps/web/src/fold.css; keep
 * the two in step.
 *
 * Wide canvases anchor the clusters to the corners and size them by height as
 * well as width, so a 4K screen gets clusters in proportion instead of a
 * laptop-sized pair. Compact ones scale both up to stay legible, and lift the
 * lower one clear of the composer, which would otherwise bury its largest splat.
 */
export function splatterLayout(
  width: number,
  height: number,
  compact = width <= 640,
): { readonly a: SplatterFrame; readonly b: SplatterFrame } {
  if (compact) {
    const [a, b] = [width * 1.25, width * 1.3];
    return {
      a: { x: width - a, y: 0, size: a },
      b: { x: width * -0.18, y: height * 0.88 - b, size: b },
    };
  }
  const a = Math.min(width * 0.58, Math.max(720, height * 0.6));
  const b = Math.min(width * 0.66, Math.max(820, height * 0.68));
  return { a: { x: width - a, y: 0, size: a }, b: { x: 0, y: height - b, size: b } };
}

/** A rectangle on a composed canvas, in its own units. */
export type SplatterRegion = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** A texture tiled over the whole composed backdrop, such as film grain. */
export type SplatterGrain = {
  /** Image URI for one tile, usually a data URI. */
  readonly href: string;
  /** Tile edge in canvas units. */
  readonly size: number;
  readonly opacity: number;
};

/**
 * The whole backdrop composed into one image the size of a canvas: field,
 * then today's merges, then the clusters, then grain. Previews use it, and
 * mobile bakes it to a bitmap once rather than painting its layers separately.
 *
 * `frame` is the region the clusters and merges lay out in, the whole canvas
 * unless given. Mobile bakes a canvas larger than a phone and lays them out in
 * the phone-shaped column it shows, so the field alone fills the rest.
 */
export function renderSplatterPreview(
  options: SplatterRenderOptions,
  width: number,
  height: number,
  {
    frame = { x: 0, y: 0, width, height },
    compact = frame.width <= 640,
    merges = [],
    grain,
  }: {
    readonly frame?: SplatterRegion;
    readonly compact?: boolean;
    readonly merges?: ReadonlyArray<MergeSplat>;
    readonly grain?: SplatterGrain;
  } = {},
): string {
  const layout = splatterLayout(frame.width, frame.height, compact);
  const field = fieldLayers(options, "f");
  const merge = mergeLayers(merges, options, compact);
  const a = clusterLayers("a", options, "a");
  const b = clusterLayers("b", options, "b");
  const cover = (
    region: SplatterRegion,
    [viewWidth, viewHeight]: readonly [number, number],
    body: string,
  ) =>
    `<svg x="${round(region.x)}" y="${round(region.y)}" width="${round(region.width)}" ` +
    `height="${round(region.height)}" viewBox="0 0 ${viewWidth} ${viewHeight}" ` +
    `preserveAspectRatio="xMidYMid slice">${body}</svg>`;
  // Clusters spill past their boxes rather than clip: their haze and glow run
  // beyond them, and a canvas wider than the frame would show the cut.
  const cluster = ({ x, y, size }: SplatterFrame, body: string) =>
    `<svg x="${round(frame.x + x)}" y="${round(frame.y + y)}" width="${round(size)}" ` +
    `height="${round(size)}" viewBox="0 0 ${SIZE} ${SIZE}" overflow="visible">${body}</svg>`;
  const grainDefs = grain
    ? `<pattern id="grain" patternUnits="userSpaceOnUse" width="${grain.size}" height="${grain.size}">` +
      `<image width="${grain.size}" height="${grain.size}" xlink:href="${grain.href}"/></pattern>`
    : "";
  return svgDocument(
    width,
    height,
    `<defs>${field.defs}${merge.defs}${a.defs}${b.defs}${grainDefs}</defs>` +
      cover({ x: 0, y: 0, width, height }, [FIELD_WIDTH, FIELD_HEIGHT], field.body) +
      (merges.length > 0 ? cover(frame, mergeFrame(compact), merge.body) : "") +
      cluster(layout.b, b.body) +
      cluster(layout.a, a.body) +
      (grain
        ? `<rect width="${width}" height="${height}" fill="url(#grain)" opacity="${alpha(grain.opacity)}"/>`
        : ""),
  );
}
