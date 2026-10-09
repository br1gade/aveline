-- The layouts a template renders for each block (B46). Until now `variant`
-- was free text: anything was stored, and the page had to guess.
ALTER TABLE "design_templates" ADD COLUMN "blockVariants" JSONB NOT NULL DEFAULT '{}';

-- Existing templates offer the three layouts the docs have always named, for
-- every block they support. Adjust per template as data.
UPDATE "design_templates" t
   SET "blockVariants" = COALESCE(
         (SELECT jsonb_object_agg(b::text, '["full-bleed","split","stacked"]'::jsonb)
            FROM unnest(t."supportedBlocks") AS b),
         '{}'::jsonb);

-- A stored variant the template does not offer falls back to its default.
UPDATE "invitation_blocks" ib
   SET "variant" = NULL
  FROM "invitations" i, "design_templates" t
 WHERE ib."invitationId" = i.id
   AND i."templateId" = t.id
   AND ib."variant" IS NOT NULL
   AND NOT COALESCE(t."blockVariants" -> (ib."type"::text), '[]'::jsonb) ? ib."variant";
