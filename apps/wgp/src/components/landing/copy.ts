/**
 * The landing page's sentences that state a count from the game: stops, fights and errands
 * in a night, powers on the keys, quality tiers, music themes, the cast. They live here so
 * copy.test.ts can derive each count from the game's own constants and fail when a sentence
 * disagrees with the simulation.
 */

/**
 * The opener: the headline is the city's own motto (Uncle Gen's line in docs/story/bible.md),
 * and the pitch under it puts the world first: villains who are the economy's tricks, and a
 * hero whose job is to keep its market honest. The pitch's second half is hidden on a phone.
 */
export const HERO_HEADLINE = { lead: "With great power", point: "comes great gas fees." } as const;
export const HERO_PITCH = {
  lead: "A 3D web-swinging game set in a city where the villains are the economy. Sandwich Man cuts every queue, Gas Goblin spikes the fees and Doc Octochain tolls the bridges. Your job is to keep its market honest: swing on real rope physics and web up two villains a night",
  more: ", sell their loot to Gwei Stacy at prices players move, and bank a night the server replays before it ranks you",
} as const;

/** The card a shared link shows. */
export const SHARE_DESCRIPTION =
  "Swing a comic-book city on real rope physics and web up parody villains. Free, in your browser, no wallet needed. Every ranked run is replay-verified, on NEAR.";

/** The site's default meta description. */
export const SITE_DESCRIPTION =
  "With Great Power (WGP) is a 3D web-swinging superhero parody game on NEAR. Swing across a comic-book city at night, stop parody villains, and climb leaderboards where every ranked night is replayed on the server.";

/** “How a night plays”: the heading and the sentence under it. */
export const NIGHT_HEADING = { lead: "Four stops across the city,", point: "and a swing between each." } as const;
export const NIGHT_INTRO =
  "Every night is a route: a warm-up villain and two errands, in a new order each night, then a boss. Between stops the whole city is yours to swing through.";

/** The comic captions and bodies that carry a count. */
export const FIGHT_PANEL = {
  caption: "A warm-up and a boss",
  body: "Villains fight in real time, each the way his joke goes. Four powers on 1–4, and one call to Gwei Stacy for backup.",
} as const;
export const ERRAND_CAPTION = "Two errands";

export const TIERS_FACT = "Three quality tiers and a frame-rate check keep the city smooth on a phone.";
export const SOUNDTRACK_FACT = "Six looping themes, a sting for every villain and a voice for the whole cast.";

/** Under “The cast”. */
export const CAST_INTRO =
  "Every character is a MakeHuman body moved by CC0 motion capture, cel-shaded in hard bands and outlined in ink like the rest of the city. All ten are original parodies.";
