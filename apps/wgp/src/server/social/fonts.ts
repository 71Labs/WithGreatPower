/**
 * Fonts for the card images. Neue Montreal is licensed and never committed: deploys copy
 * it into public/fonts (scripts/deploy-prod.sh). So each weight is looked for on disk
 * (TTF, OTF or WOFF as is; WOFF2 decoded, see ./woff2.ts), then at the site's own
 * /fonts URL when the build saw the files, and otherwise left out: `next/og` then draws
 * with the font it bundles. Loaded once per server instance, retried after a miss.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { woff2ToSfnt } from "./woff2";

export interface CardFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 500 | 700;
  style: "normal";
}

export const CARD_FONT = "Neue Montreal";
const WEIGHTS = [
  { file: "NeueMontreal-Regular", weight: 400 },
  { file: "NeueMontreal-Medium", weight: 500 },
  { file: "NeueMontreal-Bold", weight: 700 },
] as const;
const RETRY_MS = 5 * 60_000;

let cache: { at: number; fonts: CardFont[] } | null = null;
let loading: Promise<CardFont[]> | null = null;

const toArrayBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** A font file as Satori can read it, or null. */
function usable(bytes: Buffer, ext: string): Buffer | null {
  if (ext === "woff2") return woff2ToSfnt(bytes);
  return bytes.length > 12 ? bytes : null;
}

async function fromDisk(file: string, dir: string): Promise<Buffer | null> {
  for (const ext of ["ttf", "otf", "woff", "woff2"]) {
    try {
      return usable(await readFile(path.join(dir, `${file}.${ext}`)), ext);
    } catch {
      // Not there, or not decodable: try the next format.
    }
  }
  return null;
}

async function fromSite(file: string, origin: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${origin}/fonts/${file}.woff2`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    return usable(Buffer.from(await res.arrayBuffer()), "woff2");
  } catch {
    return null;
  }
}

async function load(origin: string | null, dir: string): Promise<CardFont[]> {
  const deployed = process.env.WGP_NEUE_MONTREAL === "1";
  const fonts: CardFont[] = [];
  for (const w of WEIGHTS) {
    const bytes = (await fromDisk(w.file, dir)) ?? (deployed && origin ? await fromSite(w.file, origin) : null);
    if (bytes) fonts.push({ name: CARD_FONT, data: toArrayBuffer(bytes), weight: w.weight, style: "normal" });
  }
  return fonts;
}

/** Neue Montreal for `next/og`, or [] to use its bundled font. Never throws. */
export async function cardFonts(origin: string | null = null, dir = path.join(process.cwd(), "public", "fonts")): Promise<CardFont[]> {
  if (cache && (cache.fonts.length > 0 || Date.now() - cache.at < RETRY_MS)) return cache.fonts;
  loading ??= load(origin, dir)
    .catch(() => [])
    .then((fonts) => {
      cache = { at: Date.now(), fonts };
      loading = null;
      return fonts;
    });
  return loading;
}

/** Forgets the loaded fonts (tests). */
export function resetCardFonts(): void {
  cache = null;
  loading = null;
}
