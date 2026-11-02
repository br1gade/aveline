export const WRITERS = ['api', 'export-worker', 'seating-worker', 'private-media-worker', 'template-asset-worker'];
export function assertImage(image) {
  if (!/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(image ?? '')) throw new Error('Production images must use an immutable sha256 digest');
}
export function releasePlan(profile, images) {
  for (const image of [images.api, images.backup]) if (!/^[a-z0-9][a-z0-9./:_@-]*$/.test(image ?? '')) throw new Error('Invalid image reference; production requires a digest');
  if (profile.settings.mode === 'production') { assertImage(images.api); assertImage(images.backup); }
  return ['check', 'images', 'prepare-journal-volume', 'dependencies', 'storage-bootstrap', 'candidate-preflight',
    'backup-if-populated', 'stop-writers', 'quiesced-preflight', 'migrate', 'seed', 'start-and-check', 'record-release'];
}
export function validateManifest(manifest, expected) {
  if (manifest.version !== 1 || manifest.repository !== expected.repository || manifest.runId !== String(expected.runId)) throw new Error('Invalid release repository/run');
  if (!/^[a-f0-9]{40}$/.test(manifest.commit) || manifest.commit !== expected.commit) throw new Error('Release source commit mismatch');
  const prefix = `ghcr.io/${expected.repository.toLowerCase()}/`;
  for (const [key, name] of [['api', 'api'], ['backup', 'backup']]) {
    assertImage(manifest[key]);
    if (!manifest[key].startsWith(`${prefix}${name}@`)) throw new Error('Image is outside the release repository');
  }
  return manifest;
}
