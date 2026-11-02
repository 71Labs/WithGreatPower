/**
 * GET /api/seasons → 200 { current, seasons: [{ id, name, startsAt, endsAt, status, root, digest, recordTx }] }
 */
import { connection } from "next/server";

import { getDb } from "@/server/db/client";
import { listSeasons, seasonAt } from "@/server/db/seasons";
import { handle, json } from "@/server/http";

export const GET = handle("seasons", async () => {
  await connection();
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
        root: s.root,
        digest: s.digest,
        recordTx: s.recordTx,
      })),
    },
    { cacheSeconds: 60 },
  );
});
