-- Preserve pre-existing SIGNATURE questions from earlier imports/fixtures.
-- New application-created questions already point at their version.
WITH added AS (
  INSERT INTO question_statements (id, "questionId", revision, prompt)
  SELECT 'initial-statement-' || q.id, q.id,
    COALESCE((SELECT max(s.revision) FROM question_statements s WHERE s."questionId" = q.id), 0) + 1, q.prompt
  FROM rsvp_questions q WHERE q.type = 'SIGNATURE' AND q."statementVersionId" IS NULL
  RETURNING id, "questionId"
)
UPDATE rsvp_questions q SET "statementVersionId" = added.id
FROM added WHERE q.id = added."questionId";
