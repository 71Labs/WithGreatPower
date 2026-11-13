import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { NpcTraderView } from "@/lib/market/npc-api";
import { NPC_RULE_LINES, NPC_RULES, NPC_RULES_URL } from "@/lib/market/npc-rules";

import { NPC_LAB_HREF, NPC_PRACTICE_HREF, TraderStrip } from "./other-traders";

const base: NpcTraderView = {
  id: "sandwich-man",
  name: "Sandwich Man",
  mode: "off",
  accountId: null,
  explorerUrl: null,
  status: "off",
  statusLine: "Practice only. His NEAR account isn’t funded yet, so he trades in the practice market and the economy lab’s simulation.",
  bits: null,
  items: [],
  listings: [],
  actionsLeft: 0,
  budgetLeft: 0,
  log: [],
  rules: NPC_RULE_LINES,
  rulesUrl: NPC_RULES_URL,
  seedBits: NPC_RULES.seedBits,
  now: "2026-11-12T12:00:00.000Z",
};
const strip = (npc: NpcTraderView) => renderToStaticMarkup(createElement(TraderStrip, { npc }));

describe("Sandwich Man's strip", () => {
  it("off: says he's practice only and why, links to the lab, and claims no wallet", () => {
    const html = strip(base);
    expect(html).toContain("Practice only");
    expect(html).toContain("isn’t trading on this market yet: his NEAR account isn’t funded");
    expect(html).toContain(`href="${NPC_LAB_HREF}"`);
    expect(html).toContain("Watch him trade in the economy lab");
    // He does trade in the practice market: say so, and link there too.
    expect(html).toContain("he trades in the practice market and in the economy lab’s simulation");
    expect(html).toContain(`href="${NPC_PRACTICE_HREF}"`);
    expect(html).toContain("Trade alongside him in the practice market");
    // Nothing that reads as broken or claims an account he doesn't have.
    expect(html).not.toMatch(/own wallet|Wallet<|>Off<|His latest moves|off right now/);
    // His rules are still one press away.
    expect(html).toContain("How he trades");
  });

  it("on chain: the strip with his own NEAR account, linked to the explorer", () => {
    const html = strip({ ...base, mode: "on-chain", status: "open", accountId: "sandwich.wgpnear.near", explorerUrl: "https://nearblocks.io/address/sandwich.wgpnear.near", bits: 310, statusLine: "In line." });
    expect(html).toContain("He trades by fixed rules from his own NEAR account.");
    expect(html).toContain("sandwich.wgpnear.near");
    expect(html).toContain(">Wallet<");
    expect(html).toContain("His latest moves");
    expect(html).not.toContain("Practice only");
    expect(html).toContain('href="https://nearblocks.io/address/sandwich.wgpnear.near"');
    expect(html).not.toMatch(/isn’t funded|Practice|Simulated|Sim account/);
  });

  it("on chain, after his first move: his words, where his Bits live, and each move's transaction", () => {
    // The live answer on Nov 13, 2026, after his first trade on mainnet.
    const txUrl = "https://nearblocks.io/txns/AcmNAmHr1FDHEzW6YNMFC3ULwnMmGWnyBCyihmk6LVSf";
    const html = strip({
      ...base,
      mode: "on-chain",
      status: "open",
      accountId: "sandwich.wgpnear.near",
      explorerUrl: "https://nearblocks.io/address/sandwich.wgpnear.near",
      bits: 228,
      statusLine: "I was here before you. I’ll be here after you.",
      items: [{ item: "sybil-goo", name: "Sybil goo", amount: 2 }],
      log: [{ at: "2026-11-13T07:15:06.761Z", kind: "buy", text: "Bought 2 × Sybil goo from Gwei for 72 Bits", reason: "17% under the opening price. First in line for the dip.", txHash: "AcmNAmHr1FDHEzW6YNMFC3ULwnMmGWnyBCyihmk6LVSf", txUrl }],
      now: "2026-11-13T07:17:31.569Z",
    });
    expect(html).toContain("“I was here before you. I’ll be here after you.”");
    // His own words don't push out the plain statement of where he trades from.
    expect(html).toContain("He trades by fixed rules from his own NEAR account.");
    expect(html).toContain('href="https://nearblocks.io/address/sandwich.wgpnear.near"');
    expect(html).toContain("Bought 2 × Sybil goo from Gwei for 72 Bits");
    expect(html).toContain(`href="${txUrl}"`);
    expect(html).toContain("See the transaction");
    expect(html).toContain("2 × Sybil goo");
    expect(html).not.toMatch(/isn’t funded|Practice|Simulated|Sim account|No moves yet/);
  });

  it("simulated: says his Bits are simulated, never a wallet", () => {
    const html = strip({ ...base, mode: "simulated", status: "open", accountId: "sandwich-man.sim", bits: 300, statusLine: "In line." });
    expect(html).toContain("He trades by fixed rules with his own simulated Bits.");
    expect(html).toContain("Simulated");
    expect(html).toContain("Sim account");
    expect(html).not.toMatch(/own wallet|>Wallet</);
  });
});
