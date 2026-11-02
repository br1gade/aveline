export const LAYERS = ['quality', 'containers', 'integration', 'http'];
export function pushCommits(source) {
  return [...new Set(source.trim().split('\n').filter(Boolean).flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4 || !/^[a-f0-9]{40}$/.test(fields[1]) || !/^[a-f0-9]{40}$/.test(fields[3])) throw new Error('Invalid Git pre-push update');
    return /^0+$/.test(fields[1]) ? [] : [fields[1]];
  }))];
}
export function isValidProof(proof, tree, now = Date.now()) {
  const completed = Date.parse(proof?.completedAt);
  return proof?.version === 1 && proof.tree === tree && /^[a-f0-9]{40}$/.test(tree)
    && /^sha256:[a-f0-9]{64}$/.test(proof.imageId ?? '')
    && JSON.stringify(proof.layers) === JSON.stringify(LAYERS)
    && Number.isFinite(completed) && completed <= now && now - completed <= 86400000;
}
export function isLocalDockerEndpoint(endpoint) { return typeof endpoint === 'string' && endpoint.startsWith('unix:///'); }
export async function dockerEndpoint(env, inspect) {
  if (env.DOCKER_CONTEXT) return inspect(env.DOCKER_CONTEXT);
  return env.DOCKER_HOST || inspect();
}
