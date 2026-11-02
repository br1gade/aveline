import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
const template = parseEnv(readFileSync(new URL('../../.env.production.example', import.meta.url), 'utf8'));
const token = () => randomBytes(32).toString('hex');
export function buildConfiguration(input) {
  const mode = input.mode ?? 'local'; const project = input.project ?? `aveline-${mode}`;
  if (!['local', 'production'].includes(mode) || !/^[a-z][a-z0-9-]{2,31}$/.test(project)) throw new Error('Use local/production and a lowercase project name (3–32 letters, digits, hyphens)');
  const settings = { version: 1, mode, project };
  const env = { ...template, NODE_ENV: 'production', PILOT_MODE: 'true', COMPOSE_PROJECT_NAME: project,
    API_IMAGE: mode === 'local' ? 'aveline-api:local' : '', BACKUP_IMAGE: mode === 'local' ? 'aveline-backup:local' : '',
    POSTGRES_PASSWORD: token(), MONGO_PASSWORD: token(), JWT_SECRET: token(),
    S3_BUCKET: `${project}-media`, PRIVATE_S3_BUCKET: `${project}-private`,
    PRIVACY_JOURNAL_VOLUME: `${project}-privacy-journal`, SALES_PRIVACY_JOURNAL_DIR: '/app/privacy-journal',
    SALES_PRIVACY_JOURNAL_KEY: token(), SALES_INTENT_HMAC_KEY_ID: 'v1', SALES_INTENT_HMAC_KEYS: JSON.stringify({ v1: token() }),
    SALES_INTAKE_ENABLED: 'false', SALES_INTAKE_SUPPORT_ENABLED: 'false', SALES_ENQUIRY_CONVERSION_ENABLED: 'false',
    SALES_INTAKE_OPERATIONAL_ACCEPTANCE: 'false', SALES_ENQUIRY_RETENTION_DRY_RUN: 'false',
    TEMPLATE_AUTHORING_ENABLED: 'false', TEMPLATE_ASSETS_ENABLED: 'false', TEMPLATE_PUBLISH_ENABLED: 'false', TEMPLATE_ADOPTION_ENABLED: 'false',
  };
  configureEndpoints(env, { ...input, mode });
  env.MEDIA_BUCKET_HOST = `${env.S3_BUCKET}.web.garage.localhost`;
  env.DATABASE_URL = `postgresql://aveline:${env.POSTGRES_PASSWORD}@postgres:5432/aveline?schema=public&connection_limit=10&pool_timeout=10`;
  env.MONGO_URL = `mongodb://aveline:${env.MONGO_PASSWORD}@mongo:27017/aveline?authSource=admin`;
  const garage = readFileSync(new URL('../../garage/garage.toml.example', import.meta.url), 'utf8').replaceAll('REPLACE_WITH_openssl_rand_hex_32', () => token());
  return { settings, env, garage };
}
function configureEndpoints(env, input) {
  if (input.mode === 'local') {
    Object.assign(env, { LOCAL_API_PORT: String(input.apiPort ?? 8080), LOCAL_MEDIA_PORT: String(input.mediaPort ?? 8081), LOCAL_MAIL_PORT: String(input.mailPort ?? 8026),
      API_DOMAIN: 'http://:8080', MEDIA_DOMAIN: 'http://:8081', PUBLIC_APP_URL: 'http://127.0.0.1:5173',
      CORS_ORIGINS: 'http://127.0.0.1:5173,http://localhost:5173', ACME_EMAIL: 'ops@example.test',
      S3_PUBLIC_URL: `http://127.0.0.1:${input.mediaPort ?? 8081}`, SMTP_HOST: 'mailpit', SMTP_PORT: '1025', SMTP_USER: '', SMTP_PASSWORD: '', MAIL_FROM: 'pilot@example.test' });
    for (const key of ['LOCAL_API_PORT', 'LOCAL_MEDIA_PORT', 'LOCAL_MAIL_PORT']) if (!/^\d+$/.test(env[key]) || Number(env[key]) < 1024 || Number(env[key]) > 65535) throw new Error('Local ports must be 1024–65535');
    if (new Set([env.LOCAL_API_PORT, env.LOCAL_MEDIA_PORT, env.LOCAL_MAIL_PORT]).size !== 3) throw new Error('Local ports must be distinct');
    return;
  }
  for (const key of ['apiDomain', 'mediaDomain', 'smtpHost']) if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(input[key] ?? '')) throw new Error(`Invalid ${key}`);
  if (input.apiDomain === input.mediaDomain) throw new Error('API and media domains must differ');
  const app = new URL(input.appUrl);
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash || app.pathname !== '/') throw new Error('Production appUrl must be an HTTPS origin');
  for (const key of ['acmeEmail', 'mailFrom']) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input[key] ?? '')) throw new Error(`Invalid ${key}`);
  Object.assign(env, { API_DOMAIN: input.apiDomain, MEDIA_DOMAIN: input.mediaDomain, PUBLIC_APP_URL: app.origin, CORS_ORIGINS: app.origin,
    ACME_EMAIL: input.acmeEmail, S3_PUBLIC_URL: `https://${input.mediaDomain}`, SMTP_HOST: input.smtpHost,
    SMTP_PORT: String(input.smtpPort ?? 587), SMTP_USER: input.smtpUser ?? '', SMTP_PASSWORD: input.smtpPassword ?? '', MAIL_FROM: input.mailFrom });
}
export function encodeEnvironment(values) {
  return Object.entries(values).map(([key, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\x00-\x1f\x7f]/.test(String(value))) throw new Error('Invalid key or multiline environment value');
    return `${key}=${JSON.stringify(String(value).replaceAll('$', '$$'))}`;
  }).join('\n') + '\n';
}
export function decodeEnvironment(source) {
  return Object.fromEntries(source.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#')).map((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error('Invalid environment line');
    const value = match[2].startsWith('"') ? JSON.parse(match[2]).replaceAll('$$', '$') : parseEnv(line)[match[1]];
    return [match[1], value];
  }));
}
export async function writeProfile(directory, config) {
  await mkdir(dirname(resolve(directory)), { recursive: true, mode: 0o700 });
  await mkdir(directory, { mode: 0o700 });
  for (const [name, value] of [['settings.json', JSON.stringify(config.settings, null, 2)], ['.env', encodeEnvironment(config.env)], ['.runtime.env', encodeRuntimeEnvironment(config.env)], ['garage.toml', config.garage]]) {
    await writeFile(join(directory, name), value, { mode: 0o600, flag: 'wx' });
  }
}
export async function readProfile(directory, options = {}) {
  const path = resolve(directory);
  for (const name of ['', '.env', 'settings.json', 'garage.toml']) {
    const info = await lstat(join(path, name));
    if (info.isSymbolicLink() || (info.mode & 0o077)) throw new Error('Profile directory and files must be private (0700/0600) and not symbolic links');
  }
  const settings = JSON.parse(await readFile(join(path, 'settings.json'), 'utf8'));
  if (settings.version !== 1 || !['local', 'production'].includes(settings.mode) || !/^[a-z][a-z0-9-]{2,31}$/.test(settings.project)) throw new Error('Invalid profile settings');
  const source = await readFile(join(path, '.env'), 'utf8'); const env = decodeEnvironment(source);
  if (!options.canRepairRuntime) {
    const info = await lstat(join(path, '.runtime.env'));
    if (info.isSymbolicLink() || (info.mode & 0o077) || await readFile(join(path, '.runtime.env'), 'utf8') !== encodeRuntimeEnvironment(env)) throw new Error('Runtime environment mirror differs; review .env, then run sync');
  }
  return { directory: path, settings, env, environmentHash: createHash('sha256').update(source).digest('hex'), garage: await readFile(join(path, 'garage.toml'), 'utf8') };
}
export function encodeRuntimeEnvironment(env) {
  encodeEnvironment(env);
  return Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
}
export async function saveEnvironment(profile) {
  const { open, rename } = await import('node:fs/promises');
  // Raw runtime values never undergo Compose interpolation. Canonical .env is
  // committed last; a crash between files is detected by readProfile/sync.
  for (const [name, value] of [['.runtime.env', encodeRuntimeEnvironment(profile.env)], ['.env', encodeEnvironment(profile.env)]]) {
    const temporary = join(profile.directory, `${name}-${randomBytes(8).toString('hex')}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, join(profile.directory, name));
  }
  profile.environmentHash = createHash('sha256').update(encodeEnvironment(profile.env)).digest('hex');
}
