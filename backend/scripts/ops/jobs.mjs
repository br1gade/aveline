import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
export async function writeHostJobs(profile, root, operator) {
  if (!/^\/[a-zA-Z0-9_./-]+$/.test(root ?? '') || root.split('/').includes('..') || !/^[a-z_][a-z0-9_-]*$/.test(operator ?? '') || !/^\/[a-zA-Z0-9_./-]+$/.test(profile.directory)) throw new Error('Use an absolute release root/private profile path and Unix operator user');
  const directory = join(profile.directory, 'systemd'); await mkdir(directory, { mode: 0o700 });
  const prefix = `aveline-${profile.settings.project}`;
  const command = `/usr/bin/env node ${resolve(root)}/current/backend/scripts/ops.mjs`;
  const args = `--directory ${profile.directory} --confirm ${profile.settings.project}`;
  const service = (description, action, extra = '') => `[Unit]\nDescription=${description}\nAfter=docker.service\nRequires=docker.service\n# Configure an operator OnFailure alert receiver before production.\n\n[Service]\nType=oneshot\nUser=${operator}\nUMask=0077\nWorkingDirectory=${resolve(root)}/current/backend\nExecStart=${command} ${action} ${args}\nTimeoutStartSec=30min\n${extra}`;
  const files = {
    [`${prefix}-backup.service`]: service('Aveline coordinated backup', 'backup'),
    [`${prefix}-backup.timer`]: `[Unit]\nDescription=Aveline daily backup\n[Timer]\nOnCalendar=*-*-* 03:00:00 Asia/Yerevan\nPersistent=true\nRandomizedDelaySec=120\nUnit=${prefix}-backup.service\n[Install]\nWantedBy=timers.target\n`,
    [`${prefix}-backup-check.service`]: service('Aveline off-host backup age and disk check', 'backup-check'),
    [`${prefix}-backup-check.timer`]: `[Unit]\nDescription=Aveline backup monitoring\n[Timer]\nOnBootSec=5min\nOnUnitActiveSec=15min\nUnit=${prefix}-backup-check.service\n[Install]\nWantedBy=timers.target\n`,
    [`${prefix}-backup-recover.service`]: service('Resume writers after interrupted backup', 'backup --resume-only', '[Install]\nWantedBy=multi-user.target\n'),
  };
  for (const [name, value] of Object.entries(files)) await writeFile(join(directory, name), value, { flag: 'wx', mode: 0o600 });
  return directory;
}
