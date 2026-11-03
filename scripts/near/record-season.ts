/**
 * Commit a finished season on chain by hand: Merkle root of the final board, digest of
 * the published results file, and trophies for the top 10. The contract accepts a season
 * once, forever, so this asks before sending.
 *
 * The server does this on its own: the first request after a season's freeze closes it
 * (apps/wgp/src/server/db/season-close.ts, the same `commitSeason` as here) and the
 * outbox sends record_season once the contract is live
 * (apps/wgp/src/server/near/season-record.ts). This script is the manual fallback and a
 * way to check the server's root; if both run, the server finds the season on chain and
 * settles it when the roots match.
 *
 *   cd apps/wgp
 *   pnpm exec tsx --env-file=.env.local ../../scripts/near/record-season.ts <season_id> <board.json> [--out <dir>] [--send]
 *
 * board.json, either:
 * - the final Season board, ranked: [{ "rank": 1, "accountId": "peter.wgp.testnet", "score": 123450 }, …]
 *   (the frozen `seasons.standings` mapped to rank/accountId = nearAccountId/score); or
 * - the server's published results file, GET /api/seasons/<id>/results ({ leaves: [...] }).
 *
 * Without --send it only writes <out>/season-<id>.json (byte for byte what the server
 * publishes) and prints root, digest and top 10. With --send it also calls record_season
 * from OPERATOR_ACCOUNT_ID, after you type the season id.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import { viewFunction } from "../../apps/wgp/src/lib/near/rpc";
import { chainEnv, operatorEnv } from "../../apps/wgp/src/server/near/env";
import { recordSeason } from "../../apps/wgp/src/server/near/operator";
import { provider } from "../../apps/wgp/src/server/near/rpc";
import { commitSeason, type SeasonLeaf } from "../../apps/wgp/src/server/near/season";

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes("--send");
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1]! : "season-results";
  const [seasonId, boardFile] = args.filter((a, i) => !a.startsWith("--") && (outIdx < 0 || i !== outIdx + 1));
  if (!seasonId || !boardFile) {
    console.error("usage: record-season.ts <season_id> <board.json> [--out <dir>] [--send]");
    process.exit(1);
  }

  const parsed = JSON.parse(await readFile(boardFile, "utf8")) as SeasonLeaf[] | { leaves: SeasonLeaf[] };
  const board = (Array.isArray(parsed) ? parsed : parsed.leaves).map(({ rank, accountId, score }) => ({ rank, accountId, score }));
  const commitment = commitSeason(seasonId, board);
  await mkdir(out, { recursive: true });
  const file = path.join(out, `season-${seasonId}.json`);
  await writeFile(file, commitment.file);

  console.log(`season   ${seasonId}`);
  console.log(`players  ${board.length}`);
  console.log(`root     ${commitment.root}`);
  console.log(`digest   ${commitment.digest}  (sha256 of ${file})`);
  console.log(`top 10   ${commitment.top10.join(", ")}`);
  if (!send) {
    console.log("\nDry run. Publish the file, then rerun with --send to record it on chain.");
    return;
  }

  const { contractId, network } = chainEnv();
  const operator = operatorEnv();
  const existing = await viewFunction(provider(), contractId, "get_season", { season_id: seasonId });
  if (existing) {
    console.error(`Season ${seasonId} is already recorded on ${contractId}:`, existing);
    process.exit(1);
  }
  console.log(`\nAbout to call record_season on ${contractId} (${network}) as ${operator.accountId}. This can never be changed.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Type the season id to continue: ");
  rl.close();
  if (answer.trim() !== seasonId) {
    console.log("Aborted.");
    process.exit(1);
  }
  const { txHash } = await recordSeason({ seasonId, root: commitment.root, top10: commitment.top10, digest: commitment.digest });
  console.log(`Recorded: ${txHash}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
