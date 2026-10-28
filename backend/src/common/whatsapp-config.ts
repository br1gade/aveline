export const WHATSAPP_SETTINGS = ['WHATSAPP_ACCOUNT_ID', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_API_VERSION', 'WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN'] as const;

export function validateWhatsAppConfig(raw: Record<string, unknown>): void {
  assertCompleteProductionConfig(raw);
  for (const key of ['WHATSAPP_ACCOUNT_ID', 'WHATSAPP_PHONE_NUMBER_ID']) {
    if (raw[key] && (typeof raw[key] !== 'string' || !/^\d{1,40}$/.test(raw[key]))) throw new Error(`${key} must be a decimal Meta identifier`);
  }
  const version = raw.WHATSAPP_API_VERSION;
  if (version && (typeof version !== 'string' || !/^v\d{1,3}\.0$/.test(version))) throw new Error('WHATSAPP_API_VERSION must name an explicitly verified Graph version (vN.0)');
  assertSecrets(raw);
}

function assertCompleteProductionConfig(raw: Record<string, unknown>): void {
  if (raw.NODE_ENV !== 'production' || !WHATSAPP_SETTINGS.some((key) => raw[key])) return;
  const missing = WHATSAPP_SETTINGS.filter((key) => typeof raw[key] !== 'string' || !raw[key].trim());
  if (missing.length) throw new Error(`Missing required WhatsApp configuration: ${missing.join(', ')}`);
}

function assertSecrets(raw: Record<string, unknown>): void {
  for (const key of ['WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN']) {
    const value = raw[key];
    if (value && (typeof value !== 'string' || value.length < 32 || value.length > 256)) throw new Error(`${key} must contain 32–256 characters`);
  }
}
