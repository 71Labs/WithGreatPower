import { describe, expect, it } from "vitest";

import { pickPlan } from "./plan";

describe("pickPlan", () => {
  it("needs a login first", () => {
    expect(pickPlan({})).toMatchObject({ plan: null });
    expect(pickPlan({ login: { ok: false } })).toMatchObject({ plan: null });
  });

  it("picks A when the server verifies and the MPC signature checks out", () => {
    const base = { login: { ok: true }, server: { ok: true, keyMatches: true } };
    expect(pickPlan(base)).toMatchObject({ plan: "A", provisional: true });
    expect(pickPlan({ ...base, delegate: { ok: true, payloadMatches: true }, relay: { ok: true, signatureVerifies: true } })).toMatchObject({
      plan: "A",
      provisional: false,
    });
  });

  it("picks B when only NEAR Auth can vouch for the key", () => {
    const r = { login: { ok: true }, server: { ok: false }, delegate: { ok: true, payloadMatches: true }, relay: { ok: true, signatureVerifies: true } };
    expect(pickPlan(r)).toMatchObject({ plan: "B", provisional: false });
    expect(pickPlan({ login: { ok: true }, server: { ok: true, keyMatches: false } })).toMatchObject({ plan: "B", provisional: true });
  });

  it("picks C when delegates can't be signed", () => {
    expect(pickPlan({ login: { ok: true }, server: { ok: true, keyMatches: true }, delegate: { ok: false } })).toMatchObject({ plan: "C" });
    expect(
      pickPlan({ login: { ok: true }, server: { ok: true, keyMatches: true }, delegate: { ok: true, payloadMatches: true }, relay: { ok: true, signatureVerifies: false } }),
    ).toMatchObject({ plan: "C" });
  });
});
