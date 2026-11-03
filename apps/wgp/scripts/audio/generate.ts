/**
 * Generates the game's raw audio takes with ElevenLabs from src/audio/manifest.ts.
 *
 *   pnpm audio                       # make anything missing
 *   pnpm audio --only patrol,fight   # some ids
 *   pnpm audio --force --only boss   # remake (spends credits)
 *
 * Takes land in .audio-raw/<kind>/<id>.mp3 (git-ignored); `pnpm audio:master` turns them
 * into the trimmed, loudness-matched, looped files under public/audio. An id that already
 * has a take or a mastered file is skipped, so credits are never spent twice. Every
 * request is logged to .audio-raw/log.jsonl, which is how generations are counted.
 *
 * Reads ELEVEN_LABS_API_KEY from .env.local.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { MUSIC, SFX, VOICES } from "../../src/audio/manifest";

const KEY = process.env.ELEVEN_LABS_API_KEY ?? "";
if (!KEY) {
  console.error("Set ELEVEN_LABS_API_KEY in apps/wgp/.env.local first.");
  process.exit(1);
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1]?.split(",")) : null;
const parallel = args.includes("--parallel") ? Math.max(1, Number(args[args.indexOf("--parallel") + 1]) || 1) : 2;
const PUBLIC = join(process.cwd(), "public");
const RAW = join(process.cwd(), ".audio-raw");
const API = "https://api.elevenlabs.io/v1";
const FORMAT = "output_format=mp3_44100_128";

type Kind = "sfx" | "music" | "voice";
type Job = { kind: Kind; id: string; url: string; body: unknown };

const jobs: Job[] = [
  ...SFX.map((s) => ({
    kind: "sfx" as const,
    id: s.id,
    url: `${API}/sound-generation?${FORMAT}`,
    body: {
      text: s.prompt,
      model_id: "eleven_text_to_sound_v2",
      duration_seconds: s.seconds,
      prompt_influence: s.loop ? 0.45 : 0.6,
      ...(s.loop ? { loop: true } : {}),
    },
  })),
  ...MUSIC.map((m) => ({
    kind: "music" as const,
    id: m.id,
    url: `${API}/music?${FORMAT}`,
    body: { prompt: m.prompt, music_length_ms: Math.round(m.seconds * 1000), model_id: "music_v1", force_instrumental: true },
  })),
  ...VOICES.map((v) => {
    const model = v.model ?? "eleven_v3";
    // v3 takes a stability preset (0 creative, 0.5 natural, 1 robust); v2 the full set.
    const voice_settings = model === "eleven_v3" ? { stability: 0.5, similarity_boost: 0.8 } : { stability: 0.4, similarity_boost: 0.8, style: 0.45 };
    return {
      kind: "voice" as const,
      id: v.id,
      url: `${API}/text-to-speech/${v.voice}?${FORMAT}`,
      body: { text: v.text, model_id: model, voice_settings },
    };
  }),
].filter((j) => !only || only.has(j.id));

const log = (entry: Record<string, unknown>) => {
  mkdirSync(RAW, { recursive: true });
  appendFileSync(join(RAW, "log.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
};

async function request(job: Job): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(job.url, {
      method: "POST",
      headers: { "xi-api-key": KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify(job.body),
    });
    // Too many at once: wait and try again (a refused request isn't billed).
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      continue;
    }
    return res;
  }
}

async function main() {
  let made = 0;
  let skipped = 0;
  const failed: string[] = [];
  const todo = jobs.filter((job) => {
    const done = existsSync(join(RAW, job.kind, `${job.id}.mp3`)) || existsSync(join(PUBLIC, "audio", job.kind, `${job.id}.mp3`));
    if (done && !force) skipped++;
    return force || !done;
  });

  const run = async (job: Job) => {
    const started = Date.now();
    const res = await request(job);
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      log({ kind: job.kind, id: job.id, status: res.status, detail });
      console.log(`${job.kind}/${job.id} failed (${res.status}) ${detail}`);
      failed.push(`${job.kind}/${job.id}`);
      return;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const out = join(RAW, job.kind, `${job.id}.mp3`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, bytes);
    log({ kind: job.kind, id: job.id, status: res.status, bytes: bytes.length, ms: Date.now() - started });
    made++;
    console.log(`${job.kind}/${job.id} ${Math.round(bytes.length / 1024)} KB in ${Math.round((Date.now() - started) / 1000)} s`);
  };

  const queue = [...todo];
  await Promise.all(
    Array.from({ length: Math.min(parallel, queue.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) await run(job);
    }),
  );

  console.log(`\nmade ${made}, skipped ${skipped}${failed.length ? `, failed: ${failed.join(", ")}` : ""}`);
  if (failed.length) process.exit(1);
}

void main();
