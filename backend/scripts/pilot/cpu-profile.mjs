import { Session } from 'node:inspector';
import { promisify } from 'node:util';

export function createCpuProfiler() {
  const session = new Session();
  const post = promisify(session.post.bind(session));
  let isActive = false;
  return {
    async start() {
      if (isActive) throw new Error('CPU profile already active');
      session.connect();
      await post('Profiler.enable'); await post('Profiler.start');
      isActive = true;
      return { isActive };
    },
    async stop() {
      if (!isActive) throw new Error('CPU profile not active');
      const { profile } = await post('Profiler.stop');
      await post('Profiler.disable'); session.disconnect(); isActive = false;
      // Keep code symbols and sample counts only: no source, URLs, IDs or arguments.
      const counts = new Map();
      for (const node of profile.nodes) counts.set(node.id, { function: node.callFrame.functionName || '(anonymous)', samples: 0 });
      for (const id of profile.samples) { const entry = counts.get(id); if (entry) entry.samples += 1; }
      return { totalSamples: profile.samples.length, topFunctions: [...counts.values()].sort((left, right) => right.samples - left.samples).slice(0, 25) };
    },
  };
}
