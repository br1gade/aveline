/**
 * Whether development-only shortcuts may run: a password-reset link returned
 * in the response, a default JWT secret, the fake payment gateway, the open
 * API schema, permissive CORS.
 *
 * True only when NODE_ENV says so outright. These used to be switched off by
 * `NODE_ENV === 'production'`, which fails open: unset, misspelled or
 * "staging" all counted as development, and one missing variable on a server
 * returned account-takeover links over HTTP. Root CLAUDE.md asks for these to
 * be impossible to reach in production, not merely discouraged — so anything
 * that is not an explicit development value is treated as production, and
 * boot refuses a NODE_ENV it does not recognise (`env.validation.ts`).
 */
export const ENVIRONMENTS = ['development', 'test', 'production'] as const;

export function allowsDevelopmentShortcuts(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'development' || nodeEnv === 'test';
}
