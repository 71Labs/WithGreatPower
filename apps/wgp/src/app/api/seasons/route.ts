/**
 * GET /api/seasons → 200 { current, seasons: [{ id, name, startsAt, endsAt, status, closedAt, root, digest, top10, recordTx, resultsUrl }] }
 * `resultsUrl` points at the published results file once the season has closed with players.
 * Reading it may run the season pass in the background (opening and closing seasons).
 */
import { connection } from "next/server";

import { closeSeasonsSoon } from "@/server/background";
import { getDb } from "@/server/db/client";
import { listSeasons, seasonAt } from "@/server/db/seasons";
import { handle, json } from "@/server/http";

export const GET = handle("seasons", async () => {
  await connection();
  closeSeasonsSoon();
  const db = await getDb();
  const [all, live] = await Promise.all([listSeasons(db), seasonAt(db, new Date())]);
  return json(
    {
      current: live?.id ?? null,
      seasons: all.map((s) => ({
        id: s.id,
        name: s.name,
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        status: s.status,
        closedAt: s.closedAt?.toISOString() ?? null,
        root: s.root,
        digest: s.digest,
        top10: s.top10 ?? null,
        recordTx: s.recordTx,
        resultsUrl: s.root ? `/api/seasons/${s.id}/results` : null,
      })),
    },
    { cacheSeconds: 60 },
  );
});
