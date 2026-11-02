CREATE OR REPLACE FUNCTION freeze_template_render_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.key,NEW.name,NEW."allowedFonts",NEW.palettes,NEW."supportedBlocks",NEW."blockVariants",NEW."defaultTheme",NEW."ownerScopeKey",NEW."organizationId") IS DISTINCT FROM (OLD.key,OLD.name,OLD."allowedFonts",OLD.palettes,OLD."supportedBlocks",OLD."blockVariants",OLD."defaultTheme",OLD."ownerScopeKey",OLD."organizationId") THEN RAISE EXCEPTION 'template rendering inputs and identity are versioned'; END IF;
 RETURN NEW;
END $$;
ALTER TABLE design_templates ADD CONSTRAINT positive_template_counters CHECK (revision>0 AND "nextVersionNumber">0);
ALTER TABLE design_template_versions ADD CONSTRAINT positive_template_version CHECK ("versionNumber">0);
CREATE FUNCTION refuse_template_fact_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'template receipts and audit facts are immutable'; END $$;
CREATE TRIGGER immutable_template_receipt BEFORE UPDATE OR DELETE ON template_receipts FOR EACH ROW EXECUTE FUNCTION refuse_template_fact_mutation();
CREATE TRIGGER immutable_template_audit BEFORE UPDATE OR DELETE ON template_audits FOR EACH ROW EXECUTE FUNCTION refuse_template_fact_mutation();
