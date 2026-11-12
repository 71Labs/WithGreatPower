import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { NpcTraderView } from "@/lib/market/npc-api";
import { NPC_RULE_LINES, NPC_RULES, NPC_RULES_URL } from "@/lib/market/npc-rules";

import { NPC_LAB_HREF, TraderStrip } from "./other-traders";

const base: NpcTraderView = {
  id: "sandwich-man",
  name: "Sandwich Man",
  mode: "off",
  accountId: null,
  explorerUrl: null,
  status: "off",
  statusLine: "Practice only. His NEAR account isn’t funded yet, so he trades in the economy lab’s simulation.",
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
  });

  it("simulated: says his Bits are simulated, never a wallet", () => {
    const html = strip({ ...base, mode: "simulated", status: "open", accountId: "sandwich-man.sim", bits: 300, statusLine: "In line." });
    expect(html).toContain("He trades by fixed rules with his own simulated Bits.");
    expect(html).toContain("Simulated");
    expect(html).toContain("Sim account");
    expect(html).not.toMatch(/own wallet|>Wallet</);
  });
});
