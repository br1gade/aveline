-- Postgres treats NULLs as distinct in a unique constraint, so the compound
-- unique on (organizationId, key, channel) does NOT prevent two global
-- templates — rows where organizationId IS NULL — sharing a key and channel.
-- A partial unique index covers exactly that case and makes the invariant
-- real, rather than merely declared.
CREATE UNIQUE INDEX "message_templates_global_key_channel"
  ON "message_templates" ("key", "channel")
  WHERE "organizationId" IS NULL;
