-- The unique constraint on (organizationId, channel, address) does not
-- constrain a global suppression, because in Postgres two NULLs never
-- conflict. So the same address could be suppressed platform-wide twice, and
-- an upsert keyed on that constraint cannot target the global row at all.
--
-- A partial unique index covers exactly the rows the existing constraint
-- misses. Duplicates are collapsed first, keeping the oldest row so the
-- original reason and date survive.
DELETE FROM "suppressions" s
 USING "suppressions" older
 WHERE s."organizationId" IS NULL
   AND older."organizationId" IS NULL
   AND s."channel" = older."channel"
   AND s."address" = older."address"
   AND (older."createdAt", older."id") < (s."createdAt", s."id");

CREATE UNIQUE INDEX "suppressions_global_channel_address_key"
    ON "suppressions" ("channel", "address")
 WHERE "organizationId" IS NULL;

-- Email suppression is worthless if case lets an address through, so existing
-- rows are normalised to match what the service now writes.
UPDATE "suppressions"
   SET "address" = lower("address")
 WHERE "channel" = 'EMAIL' AND "address" <> lower("address");
