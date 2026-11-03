# Credits for public/audio

Every file here (effects, the city ambience, voice lines and the score) was generated for this project with [ElevenLabs](https://elevenlabs.io) on the project owner's paid ElevenLabs account, from the prompts and lines in `src/audio/manifest.ts`:

| Folder | Made with |
|---|---|
| `sfx/` | ElevenLabs Sound Effects (`eleven_text_to_sound_v2`). `city-night` was generated as a seamless loop. |
| `music/` | Eleven Music (`music_v1`), instrumental only (`force_instrumental`): six looping beds and seven stings. |
| `voice/` | ElevenLabs Text to Speech with ElevenLabs' premade voices: Eleven v3 for the cast, Multilingual v2 for the narrator and Mary Jpeg. |

`scripts/audio/generate.ts` made the raw takes and `scripts/audio/master.py` turned them into these files: trimmed, cut into seamless loops (`src/audio/loops.ts`), loudness-matched (music -16 LUFS, effects and voices -14 LUFS, true peak -1 dBTP) and encoded as MP3. The Sybil's crowd of voices is one take layered at mastering.

## Commercial use

ElevenLabs licenses audio made on a paid plan for commercial use, including in games; audio made on the free plan is not. These files were made on the owner's paid plan. ElevenLabs' own terms govern, not this note: the [Terms of Service](https://elevenlabs.io/terms-of-use) and, for the score, the Eleven Music terms. Check them before a release, and keep the account in good standing, since the licence is tied to it.

## Originality

The prompts name no existing song, score, composer, artist, film or studio, and ask for original instrumental music; no samples or soundalikes were requested. The voices are ElevenLabs' stock voices directed as this project's own parody characters (the cast in `packages/game-core/src/rules/cast.ts`); none is a clone of, or directed to imitate, a real actor or another studio's character.
