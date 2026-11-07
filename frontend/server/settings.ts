/**
 * What the server refuses to start without. The address of the API defaults to `localhost:3000` for
 * development, which in production is this server itself: its own 404 would then tell every guest
 * their invitation doesn't exist, with nothing logged and the health check green.
 */
export function requireSettings(env: Readonly<Record<string, string | undefined>>): void {
  if (!env.API_INTERNAL_URL) {
    throw new Error('API_INTERNAL_URL must name the API: the rendering server reads it for guests');
  }
}
