import type { Config } from '@react-router/dev/config';

// Server rendering from day one (decision A1): guest pages must carry their preview tags before
// any JavaScript runs.
export default {
  appDirectory: 'src',
  ssr: true,
} satisfies Config;
