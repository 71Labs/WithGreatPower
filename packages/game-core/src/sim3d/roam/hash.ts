/**
 * An outing's state hash: the night's own hash (hash.ts, which covers the hero, his rope and the
 * swing's state) followed by free roam's fields, in a fixed order, FNV-1a over raw IEEE-754
 * bits. Only roam outings call it, so no night's or chapter's hash changes.
 */
import { Fnv, hashState } from "../../hash";
import type { SimState } from "../types";
import { hashTraffic } from "./traffic";
import { ROAM_MOVES } from "./types";

export function roamHashState(s: SimState): string {
  const f = new Fnv();
  f.word(parseInt(hashState(s), 16) >>> 0);
  const r = s.roam;
  f.bool(!!r);
  if (!r) return f.hex();
  const b = r.body;
  f.num(ROAM_MOVES.indexOf(b.move));
  for (const v of [b.moveT, b.sprintT, b.jumpBuf, b.coyote, b.grabCd, b.zipCd, b.leapCd, b.awayT, b.wallruns, b.wnx, b.wnz, b.wtop, b.wface, b.wdx, b.wdz])
    f.num(v);
  for (const v of [b.ax, b.ay, b.az, b.bx, b.by, b.bz, b.dur, b.arc, b.ex, b.ez, b.land, b.launchT]) f.num(v);
  f.bool(b.webHeld);
  const p = r.progress;
  f.num(p.stage.length);
  for (const v of p.stage) f.num(v);
  for (const v of p.items) f.num(v);
  f.num(p.pages);
  f.num(p.views);
  f.num(p.talks.length);
  for (const v of p.talks) f.num(v);
  f.num(p.breadT);
  const bot = r.bot;
  for (const v of [bot.state, bot.leg, bot.part, bot.u, bot.x, bot.y, bot.z]) f.num(v);
  f.bool(!!r.chat);
  if (r.chat) {
    f.num(r.chat.folk);
    f.num(r.chat.line);
    f.num(r.chat.ticks);
  }
  // roam-2: the traffic (every car's place round its loop, speed and hold) and the knock.
  hashTraffic(r.traffic, (v) => f.num(v));
  // roam-3: interact held (last tick's), and the relay being held and for how long.
  f.bool(r.hold.act);
  f.num(r.hold.relay);
  f.num(r.hold.ticks);
  return f.hex();
}
