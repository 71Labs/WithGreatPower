-- Season 1: Nov 5–14, 2026 (UTC), end exclusive.
INSERT INTO "seasons" ("id", "name", "starts_at", "ends_at", "status")
VALUES ('s1', 'Season 1', '2026-11-05T00:00:00Z', '2026-11-15T00:00:00Z', 'scheduled')
ON CONFLICT ("id") DO NOTHING;
