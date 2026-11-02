import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
export function parseAnswer(value, fallback = '', isSecret = false) {
  return (isSecret ? value : value.trim()) || fallback;
}
export async function askQuestions(seed = {}, onlyKey) {
  let isMuted = false;
  const output = new Writable({ write(chunk, _encoding, done) { if (!isMuted) process.stderr.write(chunk); done(); } });
  const readline = createInterface({ input: process.stdin, output, terminal: true });
  const abort = new AbortController(); readline.on('SIGINT', () => abort.abort());
  const ask = async (label, fallback = '', isSecret = false) => {
    const pending = readline.question(`${label}${fallback && !isSecret ? ` [${fallback}]` : ''}: `, { signal: abort.signal });
    isMuted = isSecret;
    try { return parseAnswer(await pending, fallback, isSecret); }
    finally { isMuted = false; if (isSecret) process.stderr.write('\n'); }
  };
  try {
    if (onlyKey) return await ask(`New ${onlyKey} (hidden)`, '', true);
    const mode = seed.mode ?? await ask('Environment (local/production)', 'local');
    const result = { mode, project: seed.project ?? await ask('Compose project', `aveline-${mode}`) };
    if (mode === 'production') {
      for (const [key, prompt, fallback] of [['apiDomain', 'API hostname'], ['mediaDomain', 'Public media hostname'], ['appUrl', 'Frontend HTTPS origin'],
        ['acmeEmail', 'Certificate contact email'], ['smtpHost', 'SMTP hostname'], ['smtpPort', 'SMTP port', '587'], ['smtpUser', 'SMTP username'], ['mailFrom', 'Sender email']]) result[key] = await ask(prompt, fallback);
      result.smtpPassword = await ask('SMTP password (hidden; blank if not needed)', '', true);
    }
    return result;
  } finally { readline.close(); }
}
