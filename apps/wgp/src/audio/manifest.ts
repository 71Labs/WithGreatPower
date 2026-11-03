/**
 * Every sound in the game, with the prompt or line that made it. scripts/audio/generate.ts
 * turns this list into raw takes with ElevenLabs, scripts/audio/master.py masters them into
 * public/audio, and the game plays them by id.
 *
 * Music is original: no samples, soundalikes or references to existing songs, scores or
 * artists. The voices are ElevenLabs premade voices directed as parody characters; none
 * imitates a real actor or another studio's character.
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

/** Beds loop under a screen or a stop; stings play once over them. */
export type MusicId =
  | "lobby"
  | "patrol"
  | "fight"
  | "boss"
  | "errand"
  | "market"
  | "victory"
  | "defeat"
  | "rug-jingle"
  | "sting-gas-goblin"
  | "sting-sandwich-man"
  | "sting-doc-octochain"
  | "sting-sybil";

export type VoiceId =
  | "narrator-bite"
  | "narrator-night"
  | "uncle-gen-power"
  | "aunt-mainnet-hello"
  | "aunt-mainnet-thanks"
  | "aunt-mainnet-patch"
  | "bearson-menace"
  | "bearson-late-edition"
  | "gas-goblin-taunt"
  | "gas-goblin-cackle"
  | "gas-goblin-defeat"
  | "sandwich-man-taunt"
  | "sandwich-man-defeat"
  | "doc-octochain-taunt"
  | "doc-octochain-defeat"
  | "sybil-taunt"
  | "sybil-defeat"
  | "gwei-backup"
  | "mary-jpeg-selfie";

export interface Sfx {
  id: SfxId;
  prompt: string;
  seconds: number;
  /** Generated as a seamless loop (ambience). */
  loop?: boolean;
}

export interface Music {
  id: MusicId;
  prompt: string;
  seconds: number;
  /** A bed: mastered with a seamless loop region. Stings play once. */
  loop?: boolean;
}

export interface Voice {
  id: VoiceId;
  /** An ElevenLabs premade voice id. */
  voice: string;
  /** What's said. Eleven v3 lines carry bracketed delivery tags, which aren't spoken. */
  text: string;
  /** eleven_v3 for acted lines; the narrator stays on multilingual v2 to match the first take. */
  model?: "eleven_v3" | "eleven_multilingual_v2";
  /** Post effect at mastering: the Sybil is a crowd of the same voice. */
  effect?: "clones";
}

export const SFX: Sfx[] = [
  { id: "thwip", prompt: "Short cartoon web shot, a quick elastic thwip with a sticky snap at the end", seconds: 0.6 },
  { id: "swing", prompt: "Fast whoosh of someone swinging past a building on a rope, airy, cartoon", seconds: 1.2 },
  { id: "release-perfect", prompt: "Bright rising sparkle chime, arcade combo success, playful", seconds: 0.8 },
  { id: "street-thud", prompt: "Cartoon thud and small bounce on asphalt, soft and comic", seconds: 0.7 },
  { id: "pow", prompt: "Punchy comic book punch impact, cartoon pow, snappy", seconds: 0.6 },
  { id: "villain-hit", prompt: "Cartoon villain getting bonked, springy boing with a crunch", seconds: 0.7 },
  {
    id: "webbed",
    prompt: "A sticky web net wrapping tight around someone: two quick stretchy elastic zips, a gooey squelch, then a bright snappy pop. Crisp modern cartoon foley, no voice",
    seconds: 1.3,
  },
  {
    id: "fee-bomb",
    prompt: "Small cartoon bomb: a short sparkling fuse fizz, a punchy comic pop explosion, then a shower of jingling coins scattering on pavement. Crisp, no voice",
    seconds: 1.6,
  },
  { id: "bread-clap", prompt: "Two huge slices of soft bread slapped together hard: a squishy, pillowy comic clap with a muffled thump. Close, dry foley", seconds: 0.6 },
  { id: "chain-sweep", prompt: "Heavy steel chain swung fast through the air: rattling links in a sharp whoosh, ending in a metallic clank", seconds: 1 },
  { id: "sybil-pop", prompt: "A glossy gooey bubble popping: a wet, slimy cartoon pop with a tiny digital glitch at the end", seconds: 0.5 },
  { id: "hurt", prompt: "Cartoon hero taking a hit: a quick muffled punch thump with a short rubbery squeak. No voice, no grunt", seconds: 0.5 },
  { id: "ko", prompt: "Cartoon knockout: a descending slide whistle into a soft rubbery bonk, then a few tiny dizzy bird chirps. No voice", seconds: 1.8 },
  {
    id: "level-up",
    prompt: "Triumphant arcade level-up: a fast rising synth arpeggio into a bold, bright brass chord with a sparkly shimmer tail. Modern game UI, punchy, not cheesy",
    seconds: 2.2,
  },
  { id: "loot", prompt: "Satisfying item pickup: a sparkly coin clink with a quick crisp paper rustle, bright and cheerful game UI sound", seconds: 0.8 },
  { id: "newspaper", prompt: "A newspaper snapped open sharply and unfolded: crisp, crackly paper, close and dry", seconds: 1.1 },
  { id: "ui-tap", prompt: "A soft sticker pressed onto paper: a gentle tactile tick with a tiny papery click. Subtle, short UI sound", seconds: 0.5 },
  { id: "ui-sheet", prompt: "A stiff paper card sliding across a desk: a short, soft swish. Subtle UI sound", seconds: 0.5 },
  {
    id: "city-night",
    prompt:
      "Night city ambience heard from a high rooftop: a distant traffic hum, a faraway siren now and then, light wind, the odd far-off car horn. Calm and spacious, no music, no voices",
    seconds: 24,
    loop: true,
  },
];

/**
 * The score's shared brief, so the cues sound like one soundtrack: the same palette,
 * the same keys (D minor for action, F major for downtime) and one hero motif.
 */
const SCORE =
  "Original instrumental score for a playful comic-book superhero video game set in a neon city at night. Modern, punchy production: tight hip-hop and breakbeat drums, warm sub bass, bright synth plucks, bold brass stabs and a cheeky, hummable heroic motif. Confident and fun, never cheesy or stock-library. Strictly instrumental, no vocals.";

const LOOPS = "Even energy from the first bar to the last: no intro build-up, no breakdown, no ending, so it loops seamlessly.";

export const MUSIC: Music[] = [
  {
    id: "lobby",
    prompt: `${SCORE} Hub theme for the hero's rooftop hideout between patrols. 90 BPM, F major. Laid-back hip-hop groove with Rhodes electric piano, muted funk guitar, soft brass swells and a little glockenspiel sparkle carrying the heroic motif. Warm, relaxed, quietly heroic, the city lights before a big night. ${LOOPS}`,
    seconds: 72,
    loop: true,
  },
  {
    id: "patrol",
    prompt: `${SCORE} Web-swinging travel music, flying between skyscrapers. 140 BPM, D minor. Driving breakbeat with crisp trap hi-hats, a soaring synth-and-brass lead playing the heroic motif, rolling sub bass, swooping string runs and whooshing risers that feel like speed and wind. Energetic and joyful, full speed ahead. ${LOOPS}`,
    seconds: 90,
    loop: true,
  },
  {
    id: "fight",
    prompt: `${SCORE} Street-brawl battle music against a comic-book villain. 150 BPM, D minor. Punchy breakbeat with big claps, slap bass, staccato brass hits and cheeky synth stabs that answer each other like punches and dodges. Scrappy, bouncy, fun tension. ${LOOPS}`,
    seconds: 60,
    loop: true,
  },
  {
    id: "boss",
    prompt: `${SCORE} Boss showdown music against a supervillain. 140 BPM with a heavy half-time feel, D minor. Distorted 808 bass, pounding toms, huge brass and organ stabs, dark synth arpeggios and a menacing villain riff answered by the heroic motif. Big, dramatic and theatrical but still playful, comic-book swagger. ${LOOPS}`,
    seconds: 72,
    loop: true,
  },
  {
    id: "errand",
    prompt: `${SCORE} Light, friendly music for helping neighbors with small favors. 104 BPM, F major. Bouncy pizzicato strings, marimba, ukulele strums, soft hand claps and a playful flute-like synth melody. Sweet, warm and a little goofy, a Saturday-morning cartoon errand. ${LOOPS}`,
    seconds: 45,
    loop: true,
  },
  {
    id: "market",
    prompt: `${SCORE} Shop music for the Mempool Market, a bustling underground night bazaar where pending deals wait in line. 100 BPM, B-flat major. A sly lounge-funk groove: clavinet, walking bass, brushed drums, muted trumpet licks, vibraphone and little ticking cash-register percussion. Sneaky, bustling and charming, haggling energy. ${LOOPS}`,
    seconds: 60,
    loop: true,
  },
  {
    id: "victory",
    prompt: `${SCORE} A short triumphant win fanfare after the hero saves the city: a snare roll into bright brass and a soaring synth playing the heroic motif, landing on a big, shining D major chord that rings out and stops. About seven seconds, then silence.`,
    seconds: 10,
  },
  {
    id: "defeat",
    prompt: `${SCORE} A short, tongue-in-cheek lose sting after the hero gets knocked out: a deflating descending phrase on muted brass with a detuned synth sliding down, comic and a little bittersweet, ending on a soft unresolved D minor chord. About five seconds, then silence.`,
    seconds: 10,
  },
  {
    id: "rug-jingle",
    prompt: `${SCORE} A short breaking-news jingle for a sensational tabloid newspaper: an urgent snare roll, ticking teletype-like percussion, a punchy brass fanfare with a cheeky twist, ending on one bold button hit. About six seconds, then silence.`,
    seconds: 10,
  },
  {
    id: "sting-gas-goblin",
    prompt: `${SCORE} A short villain entrance sting for a mischievous goblin who spikes fees from a rocket glider: a fizzing hiss, a wobbly detuned synth lick, sneering brass, landing on a sour, sneaky chord. About four seconds, then silence.`,
    seconds: 10,
  },
  {
    id: "sting-sandwich-man",
    prompt: `${SCORE} A short villain entrance sting for a smug, sneaky villain who always cuts in line, front and back: a slinky two-note bass, tiptoeing pizzicato, a sly trombone slide, landing on a cheeky stab. About four seconds, then silence.`,
    seconds: 10,
  },
  {
    id: "sting-doc-octochain",
    prompt: `${SCORE} A short villain entrance sting for a mad scientist with eight mechanical arms: a racing chromatic arpeggio on organ and metallic synths, clanking machine percussion, landing on a huge dramatic minor chord. About four seconds, then silence.`,
    seconds: 10,
  },
  {
    id: "sting-sybil",
    prompt: `${SCORE} A short villain entrance sting for a villain made of a thousand copies of himself: one eerie synth phrase copied and stacked into a crowd of detuned echoes, glitchy stutters, landing on a wide, uncanny unison chord. About four seconds, then silence.`,
    seconds: 10,
  },
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
  // The comic-book narrator: steady and dry, the joke in the last beat.
  { id: "narrator-bite", voice: V.narrator, model: "eleven_multilingual_v2", text: "A radioactive validator bites you. Nothing will ever be the same. Especially your gas fees." },
  { id: "narrator-night", voice: V.narrator, model: "eleven_multilingual_v2", text: "Night falls on the city. The villains are already out." },
  // Uncle Gen: warm, a little too pleased with his one line.
  { id: "uncle-gen-power", voice: V.gen, text: "[warmly] Remember, kid. With great power comes great responsibility. [chuckles] I'll say it again at dinner." },
  // Aunt Mainnet: sweet, never goes down, always baking.
  { id: "aunt-mainnet-hello", voice: V.aunt, text: "[cheerfully] There you are, sweetie! Still up? Me too. I never go down." },
  { id: "aunt-mainnet-thanks", voice: V.aunt, text: "[warmly] Oh, thank you, dear! Take a slice of loaf for the road." },
  { id: "aunt-mainnet-patch", voice: V.aunt, text: "[gently] Oh, look at you. Hold still, dear. I'll patch you right up." },
  // J. Jonah Bearson: a blustering tabloid editor, shorting everything at the top of his lungs.
  { id: "bearson-menace", voice: V.bearson, text: "[shouting] Menace! That web-headed menace is at it again! [impatiently] Get me pictures!" },
  { id: "bearson-late-edition", voice: V.bearson, text: "[shouting] The Daily Rug! Late edition! Hero or menace? You decide. [smugly] I already have." },
  // Gas Goblin: a manic, wheezing fee-gouger.
  { id: "gas-goblin-taunt", voice: V.goblin, text: "[mischievously] Fees are up four hundred percent, web-head!" },
  { id: "gas-goblin-cackle", voice: V.goblin, text: "[laughs maniacally] Heh heh heh heh! Surge pricing!" },
  { id: "gas-goblin-defeat", voice: V.goblin, text: "[whining] No! My fees! My beautiful fees!" },
  // Sandwich Man: smug and oily, always one step in front and one behind.
  { id: "sandwich-man-taunt", voice: V.sandwich, text: "[smugly] I was here before you. [whispers] And I'll be here after you." },
  { id: "sandwich-man-defeat", voice: V.sandwich, text: "[annoyed] Hey! I was in line first!" },
  // Doc Octochain: a grand, theatrical mad scientist.
  { id: "doc-octochain-taunt", voice: V.doc, text: "[dramatically] Eight arms. Eight chains. [menacingly] And every one of them is mine." },
  { id: "doc-octochain-defeat", voice: V.doc, text: "[frustrated] My arms! They're all knotted together! Again!" },
  // The Sybil: flat and in unison, layered into a crowd at mastering.
  { id: "sybil-taunt", voice: V.sybil, effect: "clones", text: "[flatly] We vote, unanimously, that you lose." },
  { id: "sybil-defeat", voice: V.sybil, effect: "clones", text: "[flatly] We... demand a recount." },
  // Gwei Stacy: quick, breezy, counting everything.
  { id: "gwei-backup", voice: V.gwei, text: "[playfully] Need backup, web-head? I'll invoice you in gwei." },
  // Mary Jpeg: extremely online.
  { id: "mary-jpeg-selfie", voice: V.mary, model: "eleven_multilingual_v2", text: "One photo! For the timeline!" },
];

export const audioPath = (kind: "sfx" | "music" | "voice", id: string) => `/audio/${kind}/${id}.mp3`;
