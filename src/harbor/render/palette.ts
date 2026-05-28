export const HARBOR_PALETTE = {
  skyTop: "#bfe9f1",
  skyBottom: "#84d5dc",
  waterShallow: "#6ccfc0",
  waterMid: "#318aa5",
  waterDeep: "#123f5c",
  waterNight: "#0d2d43",
  foam: "rgba(236, 255, 255, 0.78)",
  wetSand: "#caa56d",
  sand: "#e7cf89",
  grass: "#83bd59",
  grassDark: "#4c7d43",
  path: "#c29d64",
  dock: "#8f5b37",
  ink: "#17324a",
  shadow: "rgba(12, 28, 43, 0.26)",
  warmLight: "rgba(255, 188, 93, 0.18)",
  coolShade: "rgba(16, 71, 101, 0.18)",
} as const;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

export function easeInOut(progress: number) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

export function getDeterministicNoise(a: number, b: number, seed = 0) {
  const value = Math.sin((a + seed * 17.13) * 127.1 + (b - seed * 5.7) * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

export function mixHex(base: string, tint: string, amount: number) {
  const normalize = (value: string) => value.replace("#", "");
  const source = normalize(base);
  const target = normalize(tint);
  const toRgb = (value: string) => ({
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  });
  const from = toRgb(source);
  const to = toRgb(target);
  const blend = (start: number, end: number) =>
    Math.round(start + (end - start) * clamp(amount, 0, 1));

  return `rgb(${blend(from.r, to.r)}, ${blend(from.g, to.g)}, ${blend(from.b, to.b)})`;
}
