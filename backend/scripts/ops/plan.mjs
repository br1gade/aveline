export const WRITERS = ['api', 'export-worker', 'seating-worker', 'private-media-worker', 'template-asset-worker'];
export function assertImage(image) {
  if (!/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(image ?? '')) throw new Error('Production images must use an immutable sha256 digest');
}
export function assertProductionOrigins(appOrigin, mediaOrigin) {
  for (const origin of [appOrigin, mediaOrigin]) {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.port ||
      !/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/.test(parsed.hostname)) throw new Error('Use canonical HTTPS origins without a port or path');
  }
  if (appOrigin === mediaOrigin) throw new Error('App and media origins must differ');
}

export function releasePlan(profile, images, { isMaintenance = false } = {}) {
  const required = isMaintenance ? [images.api, images.backup] : [images.api, images.backup, images.web];
  for (const image of required) if (!/^[a-z0-9][a-z0-9./:_@-]*$/.test(image ?? '')) throw new Error('Invalid image reference; production requires a digest');
  if (profile.settings.mode === 'production') {
    for (const image of required) assertImage(image);
    if (!isMaintenance) {
      const { PUBLIC_APP_URL, CORS_ORIGINS, API_DOMAIN, S3_PUBLIC_URL, MEDIA_DOMAIN } = profile.env;
      assertProductionOrigins(PUBLIC_APP_URL, S3_PUBLIC_URL);
      if (PUBLIC_APP_URL !== CORS_ORIGINS || PUBLIC_APP_URL !== `https://${API_DOMAIN}` || S3_PUBLIC_URL !== `https://${MEDIA_DOMAIN}`) {
        throw new Error('Production edge, app, CORS and media origins do not match');
      }
    }
  }
  return ['check', 'images', 'prepare-journal-volume', 'dependencies', 'storage-bootstrap', 'candidate-preflight',
    'backup-if-populated', 'stop-writers', 'quiesced-preflight', 'migrate', 'seed', 'start-and-check', 'start-and-check-edge', 'record-release'];
}
export function validateManifest(manifest, expected) {
  if (manifest.version !== 2 || manifest.repository !== expected.repository || manifest.runId !== String(expected.runId)) throw new Error('Invalid release repository/run');
  if (!/^[a-f0-9]{40}$/.test(manifest.commit) || manifest.commit !== expected.commit) throw new Error('Release source commit mismatch');
  const prefix = `ghcr.io/${expected.repository.toLowerCase()}/`;
  for (const [key, name] of [['api', 'api'], ['backup', 'backup'], ['web', 'web']]) {
    assertImage(manifest[key]);
    if (!manifest[key].startsWith(`${prefix}${name}@`)) throw new Error('Image is outside the release repository');
  }
  assertProductionOrigins(manifest.appOrigin, manifest.mediaOrigin);
  return manifest;
}
