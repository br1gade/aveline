import { readFile, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function assessBackup(marker, space, settings) {
  const issues = [];
  const completedAt = typeof marker?.completedAt === 'string' ? Date.parse(marker.completedAt) : NaN;
  const ageMs = settings.now - completedAt;
  const hasValidRun = typeof marker?.runId === 'string' && /^[a-zA-Z0-9_-]+$/u.test(marker.runId);
  if (!hasValidRun || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > settings.maxAgeHours * 3600000) {
    issues.push('offhost_backup_missing_or_stale');
  }
  const availableBytes = Number(space.bavail * space.bsize);
  const usedPercent = space.blocks > 0n ? 100 * (1 - Number(space.bavail) / Number(space.blocks)) : 100;
  if (availableBytes < settings.minFreeBytes || usedPercent > settings.maxUsedPercent) issues.push('backup_volume_low_space');
  return { isHealthy: issues.length === 0, issues, ageHours: Number.isFinite(ageMs) ? Math.round(ageMs / 36000) / 100 : null, availableBytes, usedPercent: Math.round(usedPercent) };
}

async function check() {
  const directory = process.env.BACKUP_DIR ?? '/backups';
  const settings = {
    now: Date.now(),
    maxAgeHours: Number(process.env.BACKUP_MAX_AGE_HOURS ?? 30),
    minFreeBytes: Number(process.env.BACKUP_MIN_FREE_BYTES ?? 10737418240),
    maxUsedPercent: Number(process.env.BACKUP_MAX_USED_PERCENT ?? 90),
  };
  if (Object.values(settings).some((value) => !Number.isFinite(value) || value <= 0) || settings.maxUsedPercent > 100) {
    throw new Error('Invalid backup check thresholds');
  }
  let marker = null;
  try { marker = JSON.parse(await readFile(join(directory, 'offhost-success.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const report = assessBackup(marker, await statfs(directory, { bigint: true }), settings);
  console.log(JSON.stringify(report));
  if (!report.isHealthy) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await check().catch(() => {
    console.error(JSON.stringify({ isHealthy: false, issues: ['backup_check_unavailable'] }));
    process.exitCode = 1;
  });
}
