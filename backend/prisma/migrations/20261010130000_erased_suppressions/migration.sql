-- An erased person's do-not-contact record (D15, D21). Additive: an enum value
-- no existing row uses.
ALTER TYPE "SuppressionReason" ADD VALUE IF NOT EXISTS 'ERASED';
