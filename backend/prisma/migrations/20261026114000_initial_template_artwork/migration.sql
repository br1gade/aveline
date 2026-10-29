-- AlterTable
ALTER TABLE "template_materializations" ADD COLUMN     "isInitialSelection" BOOLEAN NOT NULL DEFAULT false;

CREATE FUNCTION require_published_template_artwork() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE required_count integer; ready_count integer;
BEGIN
 IF NEW.status<>'PUBLISHED' THEN RETURN NULL; END IF;
 SELECT jsonb_array_length("assetManifest") INTO required_count FROM design_template_versions WHERE id=NEW."templateVersionId";
 SELECT count(*) INTO ready_count FROM invitation_template_assets WHERE "invitationId"=NEW.id AND "templateVersionId"=NEW."templateVersionId" AND state='BOUND';
 IF required_count<>ready_count THEN RAISE EXCEPTION 'template artwork must be prepared before publication'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER published_template_artwork AFTER INSERT OR UPDATE ON invitations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_published_template_artwork();
