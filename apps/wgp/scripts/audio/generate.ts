/**
 * Generates the game's audio with ElevenLabs from src/audio/manifest.ts.
 *
 *   pnpm audio                 # make anything missing
 *   pnpm audio --only patrol   # one id
 *   pnpm audio --force         # remake everything (spends credits)
 *
 * Reads ELEVEN_LABS_API_KEY from .env.local. Files that already exist are skipped, so
 * credits are never spent twice.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { MUSIC, SFX, VOICES } from "../../src/audio/manifest";

const KEY = process.env.ELEVEN_LABS_API_KEY ?? "";
if (!KEY) {
  console.error("Set ELEVEN_LABS_API_KEY in apps/wgp/.env.local first.");
  process.exit(1);
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const PUBLIC = join(process.cwd(), "public");
const API = "https://api.elevenlabs.io/v1";

type Job = { kind: "sfx" | "music" | "voice"; id: string; url: string; body: unknown };

const jobs: Job[] = [
  ...SFX.map((s) => ({
    kind: "sfx" as const,
    id: s.id,
    url: `${API}/sound-generation?output_format=mp3_44100_128`,
    body: { text: s.prompt, duration_seconds: s.seconds, prompt_influence: 0.55, ...(s.loop ? { loop: true } : {}) },
  })),
  ...MUSIC.map((m) => ({
    kind: "music" as const,
    id: m.id,
    url: `${API}/music?output_format=mp3_44100_128`,
    body: { prompt: m.prompt, music_length_ms: Math.round(m.seconds * 1000) },
  })),
  ...VOICES.map((v) => ({
    kind: "voice" as const,
    id: v.id,
    url: `${API}/text-to-speech/${v.voice}?output_format=mp3_44100_128`,
    body: { text: v.text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.45 } },
  })),
].filter((j) => !only || j.id === only);

async function main() {
  let made = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const job of jobs) {
    const out = join(PUBLIC, "audio", job.kind, `${job.id}.mp3`);
    if (!force && existsSync(out)) {
      skipped++;
      continue;
    }
    process.stdout.write(`${job.kind}/${job.id} … `);
    const res = await fetch(job.url, {
      method: "POST",
      headers: { "xi-api-key": KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify(job.body),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      console.log(`failed (${res.status}) ${detail}`);
      failed.push(`${job.kind}/${job.id}`);
      continue;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, bytes);
    made++;
    console.log(`${Math.round(bytes.length / 1024)} KB`);
  }

  console.log(`\nmade ${made}, skipped ${skipped}${failed.length ? `, failed: ${failed.join(", ")}` : ""}`);
  if (failed.length) process.exit(1);
}

void main();
