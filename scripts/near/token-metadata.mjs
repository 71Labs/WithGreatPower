#!/usr/bin/env node
/**
 * The token images wallets and explorers show for the game's NEP-245 tokens, and the
 * contract's `set_token_metadata` arguments that name and describe them.
 *
 *   node scripts/near/token-metadata.mjs            # print set_token_metadata args (JSON)
 *   node scripts/near/token-metadata.mjs --list     # the image paths that must be served
 *   node scripts/near/token-metadata.mjs --render   # redraw apps/wgp/public/tokens/**
 *
 * The contract derives a default title and media path from each token id (contracts/wgp/
 * src/meta.rs): `<base_uri>/item/<id>.png`, `suit/<id>.png`, `badge/<id>.png`,
 * `trophy/<1|2|3|top10>.png`, `hero.png`, `bits.png`, under
 * https://www.wgponnear.fun/tokens. The args printed here add the game's own names and
 * blurbs, each image's sha256 (`media_hash`), and a shared image for any badge that has
 * no picture of its own yet. The owner sends them once after upgrading to v3 (1 yocto):
 *
 *   near contract call-function as-transaction game.wgpnear.near set_token_metadata \
 *     json-args "$(node scripts/near/token-metadata.mjs)" prepaid-gas '100.0 Tgas' \
 *     attached-deposit '1 yoctoNEAR' sign-as wgpnear.near network-config mainnet \
 *     sign-with-legacy-keychain send
 *
 * Names, blurbs and suit colours are copied from packages/game-core/src/rules/data.ts;
 * the script checks that file still lists exactly these items and suits. `--render` needs
 * rsvg-convert (librsvg) and, for the hero portrait, macOS `sips`.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "apps/wgp/public/tokens");
const SIZE = 512;

const INK = "#141414";
const PAPER = "#fffdf8";
const WELL = "#f3efe6";

/** packages/game-core/src/rules/data.ts ITEMS. */
const ITEMS = [
  { id: "fee-bomb", name: "Fee bomb", blurb: "Defused. Mostly.", rarity: "common" },
  { id: "goblin-glider", name: "Goblin glider", blurb: "Still smells of exhaust.", rarity: "rare" },
  { id: "crumbs", name: "Crumbs", blurb: "Left behind by Sandwich Man. Always.", rarity: "common" },
  { id: "sesame-seed", name: "Golden sesame seed", blurb: "From the top bun. Weirdly heavy.", rarity: "uncommon" },
  { id: "chain-link", name: "Chain link", blurb: "One of very many.", rarity: "common" },
  { id: "spare-arm", name: "Doc’s spare arm", blurb: "It still twitches when bridges open.", rarity: "rare" },
  { id: "sybil-goo", name: "Sybil goo", blurb: "There’s always more of it.", rarity: "uncommon" },
  { id: "press-pass", name: "Press pass", blurb: "Signed by Bearson, who regrets it.", rarity: "uncommon" },
];

/** packages/game-core/src/rules/data.ts SUITS. */
const SUITS = [
  { id: "classic", name: "Classic", suit: "#E5392C", web: "#141414", lens: "#FFFFFF", blurb: "The original. Red, webbed, recognizable from three blocks." },
  { id: "midnight", name: "Midnight", suit: "#2B3A8C", web: "#141414", lens: "#FFFFFF", blurb: "For heroes who mostly work nights. Which is all of them." },
  { id: "mint", name: "Mainnet mint", suit: "#1C1C1E", web: "#00EC97", lens: "#00EC97", blurb: "Black and mint, like a certain blockchain." },
  { id: "snow", name: "Snow", suit: "#F4F4F2", web: "#B6A2EC", lens: "#FFFFFF", blurb: "Very clean. Very hard to keep clean." },
  { id: "stealth", name: "Stealth", suit: "#2A2A2E", web: "#6B6B70", lens: "#E8E8E8", blurb: "Woven from Sybil goo. Nobody can tell which one is you." },
  { id: "glider", name: "Glider", suit: "#7A4FD1", web: "#1F6B2A", lens: "#F7D23E", blurb: "Stitched from a goblin glider. Comes with a faint cackle." },
  { id: "octo", name: "Octo rig", suit: "#3E8E4A", web: "#5A3A22", lens: "#FFD95A", blurb: "Doc’s spare arm, repurposed. It mostly behaves." },
  { id: "sesame", name: "Sesame", suit: "#E8B25C", web: "#7A4A1C", lens: "#FFFFFF", blurb: "Smells like the Mempool Market at lunch." },
];

/** Badges the server mints today (`trophy:badge:<id>`). */
const BADGES = [
  { id: "day-one", name: "Day one", mark: "1", blurb: "Played With Great Power on its first day on mainnet." },
  { id: "case-001", name: "Case file 001", mark: "001", blurb: "Closed case file 001, Missing: Mary Jpeg." },
  { id: "case-002", name: "Case file 002", mark: "002", blurb: "Closed case file 002, The Sybil Vote." },
  { id: "case-003", name: "Case file 003", mark: "003", blurb: "Closed case file 003." },
  { id: "daily-podium", name: "Daily podium", mark: "3", blurb: "Finished a Daily Run in the top three." },
  { id: "daily-winner", name: "Daily winner", mark: "★", blurb: "Won a Daily Run." },
  { id: "recruiter", name: "Recruiter", mark: "+3", blurb: "Brought three friends who played a verified night." },
];

const TROPHIES = [
  { file: "1", label: "1st", name: "1st place", metal: "#E9B93C", shade: "#B8861B" },
  { file: "2", label: "2nd", name: "2nd place", metal: "#C9CED6", shade: "#8E96A3" },
  { file: "3", label: "3rd", name: "3rd place", metal: "#D08B57", shade: "#9A5B2E" },
  { file: "top10", label: "Top 10", name: "Top 10", metal: "#3B46A6", shade: "#262F7A" },
];

const RARITY = { common: "#5e5a54", uncommon: "#3b46a6", rare: "#b3261e" };

/* ------------------------------------------------------------------------ drawings */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** The paper card every token sits on: a kind chip, the picture, the name. */
function card({ kind, name, chip = INK, art }) {
  const size = name.length > 16 ? 34 : 42;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${WELL}"/>
  <rect x="24" y="24" width="464" height="464" rx="36" fill="${PAPER}" stroke="${INK}" stroke-width="8"/>
  <rect x="48" y="48" width="${28 + kind.length * 15}" height="40" rx="20" fill="${chip}"/>
  <text x="${62 + kind.length * 7.5}" y="75" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="2" fill="${PAPER}">${esc(kind)}</text>
  <g stroke-linejoin="round" stroke-linecap="round">${art}</g>
  <text x="256" y="446" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="${size}" font-weight="800" fill="${INK}">${esc(name)}</text>
</svg>
`;
}

const ITEM_ART = {
  "fee-bomb": `<path d="M300 150 q30 -40 62 -22" fill="none" stroke="${INK}" stroke-width="8"/><path d="M362 128 l14 -14 M368 136 l20 -2 M356 120 l2 -20" stroke="#E5392C" stroke-width="8"/><rect x="262" y="140" width="56" height="34" rx="8" fill="${INK}"/><circle cx="256" cy="262" r="104" fill="#2A2A2E" stroke="${INK}" stroke-width="8"/><text x="256" y="298" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="104" font-weight="800" fill="#F7D23E">%</text>`,
  "goblin-glider": `<path d="M256 128 L420 330 L256 286 L92 330 Z" fill="#7A4FD1" stroke="${INK}" stroke-width="8"/><path d="M256 128 L256 286" stroke="${INK}" stroke-width="8"/><path d="M256 286 L256 356" stroke="${INK}" stroke-width="8"/><circle cx="256" cy="366" r="16" fill="#1F6B2A" stroke="${INK}" stroke-width="8"/><path d="M170 300 l-14 34 M342 300 l14 34" stroke="#1F6B2A" stroke-width="8"/>`,
  crumbs: [[176, 220, 34], [262, 176, 24], [332, 236, 40], [226, 300, 44], [318, 326, 22], [150, 322, 20], [382, 312, 16], [270, 244, 14]]
    .map(([x, y, r], i) => `<path d="M${x - r} ${y} l${r * 0.6} ${-r * 0.8} l${r * 0.9} ${r * 0.2} l${r * 0.5} ${r * 0.7} l${-r * 0.7} ${r * 0.7} l${-r} ${-r * 0.1} Z" fill="${i % 2 ? "#E8B25C" : "#C98B3C"}" stroke="${INK}" stroke-width="7"/>`)
    .join(""),
  "sesame-seed": `<path d="M256 136 C340 200 356 300 256 372 C156 300 172 200 256 136 Z" fill="#F7D23E" stroke="${INK}" stroke-width="8"/><path d="M226 222 C232 190 246 172 262 160" fill="none" stroke="${PAPER}" stroke-width="10"/><path d="M190 150 l-10 -22 M322 150 l10 -22 M256 112 l0 -22" stroke="#E9B93C" stroke-width="8"/>`,
  "chain-link": `<rect x="120" y="200" width="180" height="100" rx="50" fill="none" stroke="${INK}" stroke-width="30"/><rect x="120" y="200" width="180" height="100" rx="50" fill="none" stroke="#C9CED6" stroke-width="14"/><rect x="212" y="200" width="180" height="100" rx="50" fill="none" stroke="${INK}" stroke-width="30"/><rect x="212" y="200" width="180" height="100" rx="50" fill="none" stroke="#8E96A3" stroke-width="14"/><path d="M212 250 a50 50 0 0 1 50 -50" fill="none" stroke="${INK}" stroke-width="30"/><path d="M212 250 a50 50 0 0 1 50 -50" fill="none" stroke="#C9CED6" stroke-width="14"/>`,
  "spare-arm": `<path d="M130 350 L210 250 L300 270 L360 180" fill="none" stroke="${INK}" stroke-width="44"/><path d="M130 350 L210 250 L300 270 L360 180" fill="none" stroke="#3E8E4A" stroke-width="28"/><circle cx="210" cy="250" r="20" fill="#FFD95A" stroke="${INK}" stroke-width="8"/><circle cx="300" cy="270" r="20" fill="#FFD95A" stroke="${INK}" stroke-width="8"/><path d="M360 180 l-34 -38 M360 180 l50 -10 M360 180 l8 -52" fill="none" stroke="${INK}" stroke-width="16"/><rect x="100" y="336" width="60" height="40" rx="8" fill="#5A3A22" stroke="${INK}" stroke-width="8"/>`,
  "sybil-goo": `<path d="M150 230 C150 150 362 150 362 230 C362 262 344 268 344 300 C344 330 316 330 316 300 C316 284 296 284 296 302 L296 344 C296 378 256 378 256 344 L256 300 C256 284 232 284 232 300 C232 322 204 322 204 300 C204 268 150 270 150 230 Z" fill="#00EC97" stroke="${INK}" stroke-width="8"/><circle cx="212" cy="216" r="14" fill="${INK}"/><circle cx="300" cy="216" r="14" fill="${INK}"/><circle cx="256" cy="204" r="9" fill="${INK}"/><circle cx="330" cy="352" r="12" fill="#00EC97" stroke="${INK}" stroke-width="7"/>`,
  "press-pass": `<path d="M236 120 L236 160 M276 120 L276 160" stroke="${INK}" stroke-width="10"/><rect x="146" y="150" width="220" height="220" rx="18" fill="#F7D23E" stroke="${INK}" stroke-width="8" transform="rotate(-6 256 260)"/><g transform="rotate(-6 256 260)"><rect x="170" y="176" width="172" height="52" rx="8" fill="${INK}"/><text x="256" y="214" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="36" font-weight="800" letter-spacing="4" fill="#F7D23E">PRESS</text><path d="M176 262 h160 M176 294 h160 M176 326 h96" stroke="${INK}" stroke-width="8"/></g>`,
};

/** The hero's mask in a suit's own colours: suit, web lines, lenses. */
function maskArt({ suit, web, lens }) {
  const lines = [-64, -32, 0, 32, 64].map((dx) => `<path d="M256 136 Q${256 + dx * 1.7} 250 ${256 + dx * 0.9} 376" fill="none" stroke="${web}" stroke-width="4"/>`).join("");
  const rings = [176, 226, 286, 340].map((y) => `<path d="M${256 - 112 + Math.abs(y - 250) * 0.18} ${y} Q256 ${y + 26} ${256 + 112 - Math.abs(y - 250) * 0.18} ${y}" fill="none" stroke="${web}" stroke-width="4"/>`).join("");
  return `<path d="M256 124 C348 124 376 196 368 262 C360 330 312 386 256 386 C200 386 152 330 144 262 C136 196 164 124 256 124 Z" fill="${suit}" stroke="${INK}" stroke-width="8"/>${lines}${rings}
  <path d="M168 232 C196 214 232 224 244 262 C222 284 186 280 168 232 Z" fill="${lens}" stroke="${INK}" stroke-width="8"/>
  <path d="M344 232 C316 214 280 224 268 262 C290 284 326 280 344 232 Z" fill="${lens}" stroke="${INK}" stroke-width="8"/>`;
}

const BITS_ART = `<circle cx="256" cy="256" r="120" fill="#B8861B" stroke="${INK}" stroke-width="8"/><circle cx="256" cy="244" r="120" fill="#F7D23E" stroke="${INK}" stroke-width="8"/><circle cx="256" cy="244" r="88" fill="none" stroke="#B8861B" stroke-width="6"/><text x="256" y="286" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="120" font-weight="800" fill="${INK}">B</text>`;

function badgeArt(mark, colour = "#3B46A6") {
  const points = Array.from({ length: 24 }, (_, i) => {
    const a = (i * Math.PI) / 12;
    const r = i % 2 ? 104 : 122;
    return `${(256 + r * Math.cos(a)).toFixed(1)},${(232 + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  const size = mark.length > 2 ? 64 : 88;
  return `<path d="M206 316 L186 392 L226 372 L250 404 L262 320 Z" fill="#E5392C" stroke="${INK}" stroke-width="8"/><path d="M306 316 L326 392 L286 372 L262 404 L250 320 Z" fill="#E5392C" stroke="${INK}" stroke-width="8"/><polygon points="${points}" fill="${colour}" stroke="${INK}" stroke-width="8"/><circle cx="256" cy="232" r="78" fill="${PAPER}" stroke="${INK}" stroke-width="8"/><text x="256" y="${232 + size * 0.35}" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="${size}" font-weight="800" fill="${INK}">${esc(mark)}</text>`;
}

function trophyArt({ metal, shade, label }) {
  const size = label.length > 3 ? 40 : 56;
  return `<path d="M176 160 C120 160 120 250 196 256" fill="none" stroke="${INK}" stroke-width="22"/><path d="M176 160 C120 160 120 250 196 256" fill="none" stroke="${shade}" stroke-width="8"/><path d="M336 160 C392 160 392 250 316 256" fill="none" stroke="${INK}" stroke-width="22"/><path d="M336 160 C392 160 392 250 316 256" fill="none" stroke="${shade}" stroke-width="8"/><path d="M168 132 H344 V208 C344 268 304 300 256 300 C208 300 168 268 168 208 Z" fill="${metal}" stroke="${INK}" stroke-width="8"/><rect x="238" y="300" width="36" height="44" fill="${shade}" stroke="${INK}" stroke-width="8"/><rect x="190" y="340" width="132" height="40" rx="8" fill="${shade}" stroke="${INK}" stroke-width="8"/><text x="256" y="${216 + size * 0.35}" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="${size}" font-weight="800" fill="${INK}">${esc(label)}</text>`;
}

/* ------------------------------------------------------------------------- the set */

/** Every image, by its path under the tokens folder, with its SVG (the hero is a photo). */
function images() {
  const set = [];
  for (const i of ITEMS) set.push({ path: `item/${i.id}.png`, svg: card({ kind: "LOOT", name: i.name, chip: RARITY[i.rarity], art: ITEM_ART[i.id] }) });
  for (const s of SUITS) set.push({ path: `suit/${s.id}.png`, svg: card({ kind: "SUIT", name: `${s.name} suit`, art: maskArt(s) }) });
  set.push({ path: "bits.png", svg: card({ kind: "CURRENCY", name: "Bits", art: BITS_ART }) });
  for (const b of BADGES) set.push({ path: `badge/${b.id}.png`, svg: card({ kind: "BADGE", name: b.name, art: badgeArt(b.mark) }) });
  set.push({ path: "badge.png", svg: card({ kind: "BADGE", name: "Badge", art: badgeArt("★", "#5e5a54") }) });
  for (const t of TROPHIES) set.push({ path: `trophy/${t.file}.png`, svg: card({ kind: "TROPHY", name: t.name, chip: t.shade, art: trophyArt(t) }) });
  set.push({ path: "hero.png", from: "apps/wgp/public/media/cast/hero.webp" });
  return set;
}

/** Stops if the game's item or suit list no longer matches the copies above. */
function checkAgainstGame() {
  const data = readFileSync(join(ROOT, "packages/game-core/src/rules/data.ts"), "utf8");
  const ids = (name) => {
    const block = data.slice(data.indexOf(`export const ${name}`)).split("\n};")[0];
    return [...block.matchAll(/^\s+"?([a-z0-9-]+)"?: \{ id: /gm)].map((m) => m[1]);
  };
  for (const [name, mine] of [["ITEMS", ITEMS], ["SUITS", SUITS]]) {
    const theirs = ids(name);
    const ours = mine.map((x) => x.id);
    if (theirs.length === 0 || theirs.join() !== ours.join()) {
      console.error(`game-core ${name} is [${theirs}] but this script has [${ours}]. Update scripts/near/token-metadata.mjs.`);
      process.exit(1);
    }
  }
}

function render() {
  for (const img of images()) {
    const file = join(OUT, img.path);
    mkdirSync(dirname(file), { recursive: true });
    if (img.svg) {
      execFileSync("rsvg-convert", ["-w", String(SIZE), "-h", String(SIZE), "-o", file], { input: img.svg });
    } else {
      execFileSync("sips", ["-s", "format", "png", "-z", String(SIZE), String(SIZE), join(ROOT, img.from), "--out", file], { stdio: "ignore" });
    }
    console.error(`  ${img.path}`);
  }
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("base64");

/** The owner's `set_token_metadata` arguments, with hashes of the images on disk. */
function args() {
  const row = (key, path, title, description) => {
    const file = join(OUT, path);
    if (!existsSync(file)) {
      console.error(`Missing ${file}. Run with --render first.`);
      process.exit(1);
    }
    return [key, { title, description, media: path, media_hash: sha256(file) }];
  };
  const entries = [
    row("hero", "hero.png", null, null),
    row("item:bits", "bits.png", "Bits", "The Mempool Market’s currency. Minted for each verified night; spent at Gwei’s stall, on crafting, or invested in a merchant’s till."),
    ...ITEMS.map((i) => row(`item:${i.id}`, `item/${i.id}.png`, i.name, `${i.blurb} Loot from verified nights in With Great Power (${i.rarity}).`)),
    ...SUITS.map((s) => row(`suit:${s.id}`, `suit/${s.id}.png`, `${s.name} suit`, s.blurb)),
    // Any badge without a picture of its own shows the shared one.
    row("badge", "badge.png", null, null),
    ...BADGES.map((b) => row(`trophy:badge:${b.id}`, `badge/${b.id}.png`, `${b.name} badge`, `${b.blurb} Soulbound.`)),
  ].map(([key, meta]) => [key, Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== null))]);
  return { name: "With Great Power", base_uri: "https://www.wgponnear.fun/tokens", entries };
}

checkAgainstGame();
const mode = process.argv[2];
if (mode === "--render") {
  render();
} else if (mode === "--list") {
  for (const img of images()) console.log(`apps/wgp/public/tokens/${img.path}  ->  https://www.wgponnear.fun/tokens/${img.path}  (${SIZE}x${SIZE} PNG)`);
} else if (!mode) {
  console.log(JSON.stringify(args()));
} else {
  console.error("usage: token-metadata.mjs [--render | --list]");
  process.exit(2);
}
