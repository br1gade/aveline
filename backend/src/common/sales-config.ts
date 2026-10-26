const SALES_FLAGS = ['SALES_INTAKE_ENABLED', 'SALES_INTAKE_SUPPORT_ENABLED', 'SALES_ENQUIRY_CONVERSION_ENABLED', 'SALES_ENQUIRY_RETENTION_DRY_RUN', 'SALES_INTAKE_OPERATIONAL_ACCEPTANCE'] as const;

export function validateSalesConfig(raw: Record<string, unknown>): void {
  assertFlags(raw);
  if (raw.SALES_INTAKE_ENABLED !== 'true') return;
  validateIntentKeys(raw);
  if (typeof raw.SALES_PRIVACY_JOURNAL_DIR !== 'string' || !raw.SALES_PRIVACY_JOURNAL_DIR.startsWith('/')) throw new Error('SALES_PRIVACY_JOURNAL_DIR must be an absolute protected path');
  if (typeof raw.SALES_PRIVACY_JOURNAL_KEY !== 'string' || raw.SALES_PRIVACY_JOURNAL_KEY.length < 32) throw new Error('SALES_PRIVACY_JOURNAL_KEY must have at least 32 characters');
  if (raw.NODE_ENV === 'production' && raw.SALES_INTAKE_OPERATIONAL_ACCEPTANCE !== 'true') throw new Error('SALES_INTAKE_OPERATIONAL_ACCEPTANCE requires the documented independent journal restore and frontend acceptance evidence');
}

function validateIntentKeys(raw: Record<string, unknown>): void {
  const current = raw.SALES_INTENT_HMAC_KEY_ID;
  if (typeof current !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(current)) throw new Error('SALES_INTENT_HMAC_KEY_ID is required');
  let keys: Record<string, unknown>;
  try { keys = JSON.parse(String(raw.SALES_INTENT_HMAC_KEYS)) as Record<string, unknown>; }
  catch (error) { throw new Error('SALES_INTENT_HMAC_KEYS must be a JSON keyring', { cause: error }); }
  if (!keys || Array.isArray(keys) || typeof keys !== 'object' || Object.values(keys).some((key) => typeof key !== 'string' || key.length < 32) || typeof keys[current] !== 'string') throw new Error('SALES_INTENT_HMAC_KEYS requires the current key and retained verification keys of at least 32 characters');
}

function assertFlags(raw: Record<string, unknown>): void {
  for (const flag of SALES_FLAGS) {
    if (raw[flag] !== undefined && raw[flag] !== 'true' && raw[flag] !== 'false') throw new Error(`${flag} must be true or false`);
  }
}
