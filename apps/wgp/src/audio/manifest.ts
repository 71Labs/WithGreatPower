/**
 * Every sound in the game, with the prompt or line that made it. scripts/audio/generate.ts
 * turns this list into files under public/audio with ElevenLabs; the game plays them by id.
 * Music is original: no samples or soundalikes of existing songs.
 */

export type SfxId =
  | "thwip"
  | "swing"
  | "release-perfect"
  | "street-thud"
  | "pow"
  | "villain-hit"
  | "webbed"
  | "fee-bomb"
  | "bread-clap"
  | "chain-sweep"
  | "sybil-pop"
  | "hurt"
  | "ko"
  | "level-up"
  | "loot"
  | "newspaper"
  | "ui-tap"
  | "ui-sheet"
  | "city-night";

export type MusicId = "lobby" | "patrol" | "boss" | "victory" | "rug-jingle";

export type VoiceId =
  | "narrator-bite"
  | "narrator-night"
  | "uncle-gen-power"
  | "aunt-mainnet-thanks"
  | "bearson-menace"
  | "bearson-late-edition"
  | "gas-goblin-taunt"
  | "gas-goblin-cackle"
  | "sandwich-man-taunt"
  | "doc-octochain-taunt"
  | "sybil-taunt"
  | "gwei-backup"
  | "mary-jpeg-selfie";

export interface Sfx {
  id: SfxId;
  prompt: string;
  seconds: number;
  loop?: boolean;
}

export interface Music {
  id: MusicId;
  prompt: string;
  seconds: number;
  loop?: boolean;
}

export interface Voice {
  id: VoiceId;
  /** An ElevenLabs premade voice id. */
  voice: string;
  text: string;
}

export const SFX: Sfx[] = [
  { id: "thwip", prompt: "Short cartoon web shot, a quick elastic thwip with a sticky snap at the end", seconds: 0.6 },
  { id: "swing", prompt: "Fast whoosh of someone swinging past a building on a rope, airy, cartoon", seconds: 1.2 },
  { id: "release-perfect", prompt: "Bright rising sparkle chime, arcade combo success, playful", seconds: 0.8 },
  { id: "street-thud", prompt: "Cartoon thud and small bounce on asphalt, soft and comic", seconds: 0.7 },
  { id: "pow", prompt: "Punchy comic book punch impact, cartoon pow, snappy", seconds: 0.6 },
  { id: "villain-hit", prompt: "Cartoon villain getting bonked, springy boing with a crunch", seconds: 0.7 },
  { id: "webbed", prompt: "Sticky web wrapping someone up, stretchy rubber and goo, ending in a triumphant pop", seconds: 1.3 },
  { id: "fee-bomb", prompt: "Cartoon bomb fuse fizzing then a small pop explosion with coins jingling", seconds: 1.6 },
  { id: "bread-clap", prompt: "Two big slices of bread slapping together, soft comic clap, squishy", seconds: 0.6 },
  { id: "chain-sweep", prompt: "Heavy metal chain swinging through the air, rattling whoosh", seconds: 1 },
  { id: "sybil-pop", prompt: "Gooey bubble popping, slimy cartoon pop", seconds: 0.5 },
  { id: "hurt", prompt: "Cartoon hero taking a hit, quick bonk with a short squeak, no voice", seconds: 0.5 },
  { id: "ko", prompt: "Cartoon knockout, descending slide whistle ending in a soft bonk", seconds: 1.6 },
  { id: "level-up", prompt: "Short triumphant arcade level up fanfare, brass and synth, two seconds", seconds: 2.2 },
  { id: "loot", prompt: "Satisfying item pickup, sparkly coin and paper rustle, cheerful", seconds: 0.8 },
  { id: "newspaper", prompt: "Newspaper being snapped open and unfolded, crisp paper rustle", seconds: 1.1 },
  { id: "ui-tap", prompt: "Soft sticker being pressed onto paper, gentle tactile click", seconds: 0.5 },
  { id: "ui-sheet", prompt: "Paper card sliding across a table, short soft swish", seconds: 0.5 },
  { id: "city-night", prompt: "Night city ambience heard from a rooftop: distant traffic, faint sirens, light wind, calm", seconds: 12, loop: true },
];

export const MUSIC: Music[] = [
  {
    id: "lobby",
    prompt:
      "Playful superhero lo-fi hip hop instrumental, warm keys, soft vinyl crackle, mellow boom bap drums, night city mood, comic book charm, seamless loop, no vocals",
    seconds: 60,
    loop: true,
  },
  {
    id: "patrol",
    prompt:
      "Energetic melodic trap instrumental for a superhero swinging through a city at night: heroic synth lead, bright plucks, punchy 808s, fast hi-hats, soaring and fun, seamless loop, no vocals",
    seconds: 90,
    loop: true,
  },
  {
    id: "boss",
    prompt:
      "Intense comic villain boss fight instrumental: distorted 808 bass, choir stabs, brass hits, driving drums, menacing but playful, seamless loop, no vocals",
    seconds: 60,
    loop: true,
  },
  { id: "victory", prompt: "Short triumphant superhero victory sting, brass and synth, six seconds, no vocals", seconds: 6 },
  { id: "rug-jingle", prompt: "Short cheeky old-timey newspaper news jingle, brass and snare, five seconds, no vocals", seconds: 5 },
];

/** ElevenLabs premade voices. */
const V = {
  narrator: "nPczCjzI2devNBz1zQrb", // Brian: deep, steady
  gen: "JBFqnCBsd6RMkjVDRZzb", // George: warm
  aunt: "XrExE9yKIg1WjnnlVkGX", // Matilda: friendly
  bearson: "2EiwWnXFnvU5JabPnv8n", // Clyde: gravelly
  goblin: "N2lVS1w4EtoT3dr4eOWO", // Callum: hoarse, intense
  sandwich: "IKne3meq5aSn9XLyUdCD", // Charlie: casual
  doc: "onwK4e9ZLuTAKqWW03F9", // Daniel: deep, precise
  sybil: "VR6AewLTigWG4xSOukaG", // Arnold: crisp
  gwei: "cgSgspJ2msm6clMCkdW9", // Jessica: young, expressive
  mary: "FGY2WhTYpPnrIDTdsKH5", // Laura: upbeat
} as const;

export const VOICES: Voice[] = [
  { id: "narrator-bite", voice: V.narrator, text: "A radioactive validator bites you. Nothing will ever be the same. Especially your gas fees." },
  { id: "narrator-night", voice: V.narrator, text: "Night falls on the city. The villains are already out." },
  { id: "uncle-gen-power", voice: V.gen, text: "Remember, kid. With great power comes great responsibility. I'll say it again at dinner." },
  { id: "aunt-mainnet-thanks", voice: V.aunt, text: "Oh, thank you, dear! Take a slice of loaf for the road." },
  { id: "bearson-menace", voice: V.bearson, text: "Menace! That web-headed menace is at it again! Get me pictures!" },
  { id: "bearson-late-edition", voice: V.bearson, text: "The Daily Rug! Late edition! Hero or menace? You decide. I already have." },
  { id: "gas-goblin-taunt", voice: V.goblin, text: "Fees are up four hundred percent, web-head!" },
  { id: "gas-goblin-cackle", voice: V.goblin, text: "Heh heh heh heh! Surge pricing!" },
  { id: "sandwich-man-taunt", voice: V.sandwich, text: "I was here before you. And I'll be here after you." },
  { id: "doc-octochain-taunt", voice: V.doc, text: "Eight arms. Eight chains. And every one of them is mine." },
  { id: "sybil-taunt", voice: V.sybil, text: "We vote, unanimously, that you lose." },
  { id: "gwei-backup", voice: V.gwei, text: "Need backup, web-head? I'll invoice you in gwei." },
  { id: "mary-jpeg-selfie", voice: V.mary, text: "One photo! For the timeline!" },
];

export const audioPath = (kind: "sfx" | "music" | "voice", id: string) => `/audio/${kind}/${id}.mp3`;
