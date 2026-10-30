import { compose, docker } from './runtime.mjs';
import { saveEnvironment } from './config.mjs';
const pause = () => new Promise((resolve) => setTimeout(resolve, 1000));
export async function prepareJournal(ctx) {
  const name = ctx.profile.env.PRIVACY_JOURNAL_VOLUME;
  if (name !== `${ctx.profile.settings.project}-privacy-journal`) throw new Error('Journal volume must belong to this project');
  let existing;
  try { existing = JSON.parse(await docker(ctx, ['volume', 'inspect', name], 'inspect journal volume')); } catch { /* A fresh deployment has no journal volume. */ }
  if (existing) {
    if (existing[0].Labels?.['com.aveline.project'] !== ctx.profile.settings.project) throw new Error('Existing journal volume ownership must be reviewed');
    return;
  }
  await docker(ctx, ['volume', 'create', '--label', `com.aveline.project=${ctx.profile.settings.project}`, name], 'create independent journal volume');
  await docker(ctx, ['run', '--rm', '--user', '0:0', '--mount', `type=volume,source=${name},target=/app/privacy-journal`, '--entrypoint', 'sh', ctx.images.api, '-c', 'chown 1000:1000 /app/privacy-journal && chmod 700 /app/privacy-journal'], 'prepare new journal volume permissions');
}
export async function bootstrapStorage(ctx) {
  const garage = (args) => compose(ctx, ['exec', '-T', 'garage', '/garage', ...args], 'configure Garage');
  let status;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { status = await garage(['status']); break; } catch { await pause(); }
  }
  if (!status) throw new Error('Garage did not become ready');
  const pending = status.split('\n').filter((line) => line.includes('NO ROLE ASSIGNED'));
  if (pending.length > 1) throw new Error('Automatic bootstrap supports only one Garage node');
  if (pending.length) {
    const nodeId = pending[0].trim().split(/\s+/)[0];
    if (!/^[a-f0-9]{16,64}$/.test(nodeId)) throw new Error('Unexpected Garage node identity');
    await garage(['layout', 'assign', '-z', 'aveline', '-c', '10G', nodeId]);
    await garage(['layout', 'apply', '--version', '1']);
  }
  const { env } = ctx.profile;
  const alias = `${ctx.profile.settings.project}-backend`;
  let key;
  try { key = await garage(['key', 'info', alias, '--show-secret']); }
  catch { await garage(['key', 'create', alias]); key = await garage(['key', 'info', alias, '--show-secret']); }
  const id = /^Key ID:\s*(\S+)/m.exec(key)?.[1];
  const secret = /^Secret key:\s*(\S+)/m.exec(key)?.[1];
  if (!id || !secret) throw new Error('Garage key could not be read; no configuration was changed');
  if ((env.S3_ACCESS_KEY_ID && env.S3_ACCESS_KEY_ID !== id) || (env.S3_SECRET_ACCESS_KEY && env.S3_SECRET_ACCESS_KEY !== secret)) throw new Error('Stored Garage credentials differ; refusing to rotate recovery identity');
  for (const bucket of [env.S3_BUCKET, env.PRIVATE_S3_BUCKET]) {
    try { await garage(['bucket', 'info', bucket]); } catch { await garage(['bucket', 'create', bucket]); }
    await garage(['bucket', 'allow', '--read', '--write', bucket, '--key', alias]);
  }
  await garage(['bucket', 'website', '--deny', env.PRIVATE_S3_BUCKET]);
  await garage(['bucket', 'website', '--allow', env.S3_BUCKET]);
  Object.assign(env, { S3_ACCESS_KEY_ID: id, S3_SECRET_ACCESS_KEY: secret });
  await saveEnvironment(ctx.profile);
}
