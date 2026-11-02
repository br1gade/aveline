-- design_templates.id is part of template_active_version_scope_fk, so the
-- schema declares it in a relation and Prisma no longer generates a cuid for
-- it. The database supplies the id instead. Existing ids are untouched, and a
-- replica still on the old schema keeps sending its own cuid.
SET lock_timeout = '5s';
SET statement_timeout = '30s';
ALTER TABLE "design_templates" ALTER COLUMN "id" SET DEFAULT (gen_random_uuid())::text;
