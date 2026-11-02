/**
 * What a guest's local save keeps when it's imported on first sign-in (POST /api/migrate,
 * src/server/db/migrate-save.ts). Shared with the browser so the offer can say so.
 */
export const IMPORT_CAPS = {
  level: 3,
  night: 3,
  perItem: 3,
  totalItems: 10,
  albumEach: 10,
  stat: 1000,
} as const;
