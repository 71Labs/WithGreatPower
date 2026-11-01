# With Great Power (WGP)

A friendly neighborhood superhero parody game, built for NEAR HACKATHON.

Get bitten by a radioactive validator, pick three powers and swing across the city each night to stop the villains draining its treasury:
- **Gas Goblin** spikes the fees.
- **Sandwich Man** eats your trades.
- **Doc Octochain** holds the bridge.
- **The Sybil** keeps copying himself.

Everything you do ends up in tomorrow's edition of *The Daily Rug*, edited by J. Jonah Bearson, who is sure you're a menace.

## Run it

```bash
cd apps/wgp
pnpm install
pnpm dev            # http://localhost:3000, the game is at /play
```

Other scripts:

| Command | What it does |
| --- | --- |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint, including a rule that every icon comes from `src/components/icons.tsx` |
| `pnpm simulate 14` | A bot plays 14 nights through the real game engine and prints each night, for balance checks |

## How a night plays

1. **Tonight (`/play`).** The city map shows tonight's four stops: a warm-up fight, two errands for the neighbors and a boss, plus the quest The Daily Rug set yesterday.
2. **Swing (`/play/patrol`).** Between stops you swing on a web. Let go in the sweet spot for a perfect swing. Perfect swings build a combo that boosts the XP from your next fight; a miss costs health and web fluid.
3. **Fight.** Fights are turn-based. Each villain telegraphs his next move, and you answer with the powers in your loadout, a punch, or one call to Gwei Stacy. Each villain fights the way his joke goes:
   - Sandwich Man front-runs you, so his hit lands before your move.
   - Doc Octochain jams your powers, so they cost more web fluid.
   - The Sybil duplicates, and his copies soak your hits.
4. **Errands.** Help Aunt Mainnet, hear Uncle Gen out, give Bearson a quote. Choices move your responsibility and reputation.
5. **The night's haul.** You collect XP, loot and stickers. Level-ups unlock new powers, and loot crafts new suits.
6. **The Daily Rug (`/play/rug`).** The paper writes up your night. Vote hero or menace, and pick up tomorrow's quest.

## Project layout

```
apps/wgp/
  src/game/              the rules: types, content data, a pure reducer, the save store
  src/app/(site)/        the landing page
  src/app/play/          the game: tonight, patrol, bitten (sign-up), hero, suits, album, rug
  src/components/cast/   the sticker cast (hand-drawn SVG, original parody designs)
  src/components/art/    WebGL and ASCII art: the dithered city, webs, blooms
  scripts/simulate.ts    the balance bot
```

The game engine (`src/game/engine.ts`) is one pure function, `reduce(save, action)`. Randomness is seeded, so a save always replays the same way.

## NEAR

Today your hero and progress are saved in your browser. The engine already keeps heroes, powers, loot and suits as plain data, which is the shape they need to live on NEAR. The next steps are:
- sign-in with NEAR Auth (Google, Apple, email or passkey; no seed phrase);
- heroes and items as NEP-245 multi-tokens in one contract;
- suit trades through NEAR Intents.

Until those land, nothing in the game touches a blockchain.

## Credits and disclosure

- **Parody.** All characters are original designs. With Great Power is not affiliated with, endorsed by or sponsored by any comic book publisher or film studio.
- **AI-assisted.** Code, art and copy were written with AI assistance (Claude Code), reviewed and directed by the team.
- **Fonts.** The site uses Neue Montreal by Pangram Pangram when its files are present in `apps/wgp/public/fonts/`. They are not in this repository and need a webfont license; without them the site falls back to Inter.
