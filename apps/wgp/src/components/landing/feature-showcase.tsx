import type { ReactNode } from "react";
import {
  Award,
  Building,
  Clock,
  Exchange,
  Gift,
  Handshake,
  Layers,
  MapPin,
  Medal,
  Megaphone,
  Shirt,
  Sparkles,
  Swords,
  Target,
  UsersRound,
  Vote,
  Zap,
} from "@/components/icons";

import { MEDIA_PALETTES } from "@/components/art/scenes";
import { Chip, IconTile, InlineTwoTone, Section } from "@/components/frame";
import { LinkButton } from "@/components/ui";
import { PLAY_URL } from "@/lib/site";

import { EncounterCard, PatrolCard, PowerCard, RugCard, SuitCard } from "./game-cards";
import { FeatureTabs, type FeatureTab } from "./feature-tabs";

/** Right column of a tab: chip, two-tone headline, one paragraph, four features. */
function FeatureBody({
  chip,
  lead,
  point,
  children,
  features,
}: {
  chip: string;
  lead: ReactNode;
  point: ReactNode;
  children: ReactNode;
  features: { icon: ReactNode; text: ReactNode }[];
}) {
  return (
    <>
      <Chip>{chip}</Chip>
      <InlineTwoTone
        as="h3"
        size="card"
        lead={lead}
        point={point}
        className="mt-5 sm:text-[34px]! sm:leading-[38px]! lg:text-[clamp(1.75rem,0.9rem+1.35vw,2.375rem)]! lg:leading-[1.1]!"
      />
      <p className="mt-4 max-w-[46ch] text-[16px] leading-[26px] text-ink-subtle sm:text-[17px] sm:leading-[28px]">
        {children}
      </p>
      <ul className="mt-8 flex flex-col gap-3.5">
        {features.map((f, i) => (
          <li key={i} className="flex items-center gap-4 text-[16px] leading-6 text-ink sm:text-[17px]">
            <IconTile>{f.icon}</IconTile>
            <span>{f.text}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

const sw = 2;

const tabs: FeatureTab[] = [
  {
    id: "swing",
    label: "Swing",
    media: { scene: "skyline", palette: MEDIA_PALETTES.nightcity, seed: 9 },
    cardLabel:
      "Example: tonight’s patrol, four stops in about 12 minutes: Gas Goblin in Sector 7, Sandwich Man at Mempool Market, Doc Octochain on the bridge, and Aunt Mainnet’s groceries.",
    card: <PatrolCard />,
    body: (
      <FeatureBody
        chip="Swing"
        lead="The whole city,"
        point="one swing at a time."
        features={[
          { icon: <MapPin strokeWidth={sw} />, text: "Five districts, each with its own villain" },
          { icon: <Clock strokeWidth={sw} />, text: "Patrols short enough for a coffee break" },
          { icon: <Zap strokeWidth={sw} />, text: "Chain swings into combos for bonus XP" },
          { icon: <Building strokeWidth={sw} />, text: "Errands for the neighbors count too" },
        ]}
      >
        Every night the city posts a patrol: villains to stop, neighbors to help and a route between them. Swing it in
        one go, or pick the stops you like.
      </FeatureBody>
    ),
  },
  {
    id: "powers",
    label: "Powers",
    media: { scene: "webs", palette: MEDIA_PALETTES.ember, seed: 3 },
    cardLabel:
      "Example: the Node sense power, rare, level 3 of 5, with a range of 3 blocks, a 45 second cooldown and 72% mastery.",
    card: <PowerCard />,
    body: (
      <FeatureBody
        chip="Powers"
        lead="Powers you level"
        point="and actually own."
        features={[
          { icon: <Sparkles strokeWidth={sw} />, text: "Start with three of twelve powers" },
          { icon: <Target strokeWidth={sw} />, text: "Level a power by using it" },
          { icon: <Layers strokeWidth={sw} />, text: "Every power is an item you hold on NEAR" },
          { icon: <Handshake strokeWidth={sw} />, text: "Lend one to a friend for a night" },
        ]}
      >
        A radioactive validator gives you your first three. The rest you earn on patrol, level by using them, and keep
        when you log off.
      </FeatureBody>
    ),
  },
  {
    id: "villains",
    label: "Villains",
    media: { scene: "bloom", palette: MEDIA_PALETTES.dusk2, seed: 8 },
    cardLabel:
      "Example: a boss fight with Gas Goblin in Sector 7. The goblin is at 340 of 1,000, you are at 820 of 1,000, and Node sense just dodged his fee bomb.",
    card: <EncounterCard />,
    body: (
      <FeatureBody
        chip="Villains"
        lead="Villains who drain the city."
        point="Webs that stop them."
        features={[
          { icon: <Swords strokeWidth={sw} />, text: "A boss in every district" },
          { icon: <UsersRound strokeWidth={sw} />, text: "Call a friend in mid-fight" },
          { icon: <Gift strokeWidth={sw} />, text: "Catch a villain, keep their gear" },
          { icon: <Medal strokeWidth={sw} />, text: "Weekly raids against the whole rogues’ gallery" },
        ]}
      >
        Gas Goblin spikes the fees, Sandwich Man eats your trades, The Sybil copies himself. Each one fights the way the
        joke goes.
      </FeatureBody>
    ),
  },
  {
    id: "rug",
    label: "The Daily Rug",
    media: { scene: "contours", palette: MEDIA_PALETTES.comic, seed: 2 },
    cardLabel:
      "Example: The Daily Rug’s late edition asks whether The Node is a hero or a menace. By J. Jonah Bearson. 71% of readers say hero.",
    card: <RugCard />,
    body: (
      <FeatureBody
        chip="The Daily Rug"
        lead="The city talks back."
        point="Loudly."
        features={[
          { icon: <Megaphone strokeWidth={sw} />, text: "Headlines written from what players did" },
          { icon: <Vote strokeWidth={sw} />, text: "Vote hero or menace, every day" },
          { icon: <Target strokeWidth={sw} />, text: "Quests straight from the front page" },
          { icon: <Award strokeWidth={sw} />, text: "Make the front page, keep the clipping" },
        ]}
      >
        J. Jonah Bearson runs the city’s least trusted paper. Yesterday’s patrol is tomorrow’s scandal, and the
        readers decide whether you’re a hero.
      </FeatureBody>
    ),
  },
  {
    id: "suits",
    label: "Suits",
    media: { scene: "glass", palette: MEDIA_PALETTES.ember, seed: 13 },
    cardLabel:
      "Example: the suit shop, with a stealth suit made from Sybil goo for 12 NEAR, a glider suit from a goblin glider for 30 NEAR, and an octo-arm rig for 48 NEAR.",
    card: <SuitCard />,
    body: (
      <FeatureBody
        chip="Suits"
        lead="Your suit,"
        point="stitched from their loot."
        features={[
          { icon: <Shirt strokeWidth={sw} />, text: "Craft suits from villain loot" },
          { icon: <Exchange strokeWidth={sw} />, text: "Trade them with other players" },
          { icon: <Sparkles strokeWidth={sw} />, text: "Cosmetic only: no pay-to-win" },
          { icon: <Gift strokeWidth={sw} />, text: "New drops every Friday" },
        ]}
      >
        Catch Gas Goblin, keep his glider, and turn it into a suit. Wear it, sell it, or give it to a friend who keeps
        missing him.
      </FeatureBody>
    ),
  },
];

export function FeatureShowcase() {
  return (
    <Section id="powers" labelledBy="features-title" inner="px-4 py-20 sm:px-10 sm:py-28">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
        <div className="flex flex-col items-start gap-6">
          <Chip>Everything a hero needs</Chip>
          <InlineTwoTone
            id="features-title"
            size="display"
            lead={
              <>
                Swing, fight, level up.
                <br className="hidden md:inline" /> Keep
              </>
            }
            point="everything."
          />
        </div>
        <LinkButton href={PLAY_URL} size="lg" className="shrink-0 self-start lg:mb-2 lg:self-auto">
          Play now
        </LinkButton>
      </div>
      <div className="mt-14 sm:mt-20">
        <FeatureTabs tabs={tabs} label="What you do in WGP" />
      </div>
    </Section>
  );
}
