/**
 * A bot plays N nights through the real reducer and prints what happened, so balance
 * changes can be checked without clicking through the game. Run: pnpm simulate [nights]
 */
import { moveBlocked, newSave, reduce, craftShortfall } from "../src/game/engine";
import { ERRANDS, POWERS, SUITS } from "../src/game/data";
import type { MoveId, PowerId, Save, SuitId } from "../src/game/types";

const nights = Number(process.argv[2] ?? 12);
let save: Save = reduce(newSave(), { type: "create-hero", name: "Test Hero", suit: "classic", powers: ["web-sling", "web-shield", "node-sense"] });
let turns = 0;
let fights = 0;
let losses = 0;
const grades = ["perfect", "good", "good", "miss"] as const;

function chooseMove(s: Save): MoveId {
  const f = s.patrol!.fight!;
  const p = s.patrol!;
  if (p.gweiCalls > 0 && f.hp > f.maxHp * 0.6 && f.boss) return "gwei";
  const intent = f.intents[0];
  const prefer: PowerId[] = [];
  if (intent.value >= 15 && ["attack", "heavy", "frontrun", "drain", "swarm"].includes(intent.kind)) prefer.push("node-sense", "zk-cloak", "web-shield", "yank");
  if (p.hp < p.maxHp * 0.4) prefer.push("wall-crawl", "gas-refund");
  prefer.push("web-bomb", "validator-slam", "finality", "front-run", "web-sling");
  for (const m of prefer) if (!moveBlocked(s, m)) return m;
  return "punch";
}

for (let n = 0; n < nights; n++) {
  save = reduce(save, { type: "start-patrol" });
  let guard = 0;
  while (save.patrol && save.patrol.phase !== "summary" && guard++ < 500) {
    const p = save.patrol;
    if (p.phase === "swing") save = reduce(save, { type: "swing", grade: grades[(n + p.index) % grades.length] });
    else if (p.phase === "stop") {
      const stop = p.stops[p.index];
      if (stop.kind === "fight") {
        if (p.fight && !p.fight.result) {
          save = reduce(save, { type: "move", move: chooseMove(save) });
          turns++;
          continue;
        }
        fights++;
        if (p.fight?.result === "lost") losses++;
      } else if (p.results.length <= p.index) {
        const errand = ERRANDS.find((x) => x.id === stop.errand)!;
        save = reduce(save, { type: "errand", choice: errand.choices[0].id });
      }
      save = reduce(save, { type: "leave-stop" });
    }
  }
  if (guard >= 500) throw new Error("patrol did not finish");
  const p = save.patrol!;
  save = reduce(save, { type: "finish-patrol" });
  save = reduce(save, { type: "vote", side: "hero" });
  while (save.hero!.pendingPicks > 0) {
    const next = (Object.keys(POWERS) as PowerId[]).find((id) => !save.hero!.powers[id])!;
    save = reduce(save, { type: "pick-power", power: next });
  }
  for (const id of Object.keys(SUITS) as SuitId[]) if (!craftShortfall(save, id)) save = reduce(save, { type: "craft-suit", suit: id });
  const h = save.hero!;
  const ed = save.editions[0];
  console.log(
    `night ${p.night}: ${p.results.map((r) => `${r.kind === "fight" ? r.outcome.toUpperCase() : "errand"}:${r.who}`).join(", ")}` +
      ` | hp ${p.hp}/${p.maxHp} fluid ${p.fluid} | lvl ${h.level} xp ${h.xp} resp ${h.responsibility} rep ${save.reputation}` +
      ` | "${ed.headline}" poll ${ed.heroPoll}% | quest→${ed.quest?.villain}`,
  );
  save = reduce(save, { type: "sleep" });
}
console.log(`\nfights ${fights}, losses ${losses}, avg turns/fight ${(turns / Math.max(1, fights)).toFixed(1)}`);
console.log("inventory", JSON.stringify(save.inventory), "suits", save.suits.join(","), "powers", Object.keys(save.hero!.powers).length);
console.log("album", JSON.stringify(save.album));
