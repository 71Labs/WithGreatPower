/**
 * The sticker look, as data, shared by the game renderer and the UI. Characters are
 * stickers (flat fills, a 2.5px ink outline, a white border); the city is drawn the same
 * way: flat shapes, bold ink outlines, no gradients or dither.
 */
export const INK = "#141414";
export const PAPER = "#FFFDF8";
export const STICKER_EDGE = "#FFFFFF";

/** Outline widths at 1× zoom. Far layers get thinner lines so depth reads. */
export const LINE = { near: 3, mid: 2.25, far: 1.5, detail: 1.5 } as const;

/** The night city. Every fill is flat; light comes from windows, signs and the moon. */
export const CITY = {
  skyTop: "#1F2350",
  skyMid: "#2B3170",
  skyLow: "#3C3F8C",
  moon: "#FFF1BF",
  star: "#FFF6D8",
  cloud: "#3A3E86",
  /** Building fills by depth: far → near. */
  far: ["#3A3F86", "#424891"],
  mid: ["#4B529F", "#555CAB", "#4A4F96"],
  near: ["#5E66B8", "#6A70C4", "#575EAE", "#7078C9"],
  /** A few warm buildings so the skyline isn't one hue. */
  accentBuildings: ["#B5562F", "#8E3B58", "#2F7A6A"],
  windowLit: "#FFD95A",
  windowWarm: "#FFB347",
  windowDark: "#2A2E62",
  rooftop: "#2B2F68",
  waterTower: "#B5562F",
  waterTowerBand: "#8A3E20",
  street: "#1B1E45",
  streetLine: "#FFD95A",
  bridge: "#C0392B",
  cable: "#E8E4DA",
  billboard: "#FFFDF8",
  neonRed: "#FF4B3E",
  neonMint: "#00EC97",
  webLine: "#FFFFFF",
} as const;

/** Parody ads for billboards and rooftop signs. */
export const BILLBOARDS = [
  "THE DAILY RUG · Menace strikes again",
  "GAS 400% OFF*  *on",
  "Aunt Mainnet’s Loaf · Never goes down",
  "Mempool Market · No cutting",
  "Doc’s Bridge Co. · 8 arms, 0 refunds",
  "Validator Heights · Now leasing",
] as const;
