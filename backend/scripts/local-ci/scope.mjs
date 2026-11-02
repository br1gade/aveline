export function localResourceName(fallback, suffix, env = process.env) {
  if (!env.AVELINE_LOCAL_CI_SCOPE) return fallback;
  if (!/^av-ci-[a-f0-9]{12}$/.test(env.AVELINE_LOCAL_CI_SCOPE) || !/^[a-z]$/.test(suffix)) throw new Error('Invalid disposable local CI scope');
  return `${env.AVELINE_LOCAL_CI_SCOPE}-${suffix}${process.pid}`;
}
