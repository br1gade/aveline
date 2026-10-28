/** Test cleanup truncates every public table, so validate before connecting. */
export function assertTestDatabaseUrl(value: string, environment = process.env.NODE_ENV): URL {
  if (environment === 'production') throw new Error('Refusing destructive test setup in production');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Refusing destructive test setup: invalid test database URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^\/[a-z][a-z0-9_]*_test(?:_[a-z0-9]+)?$/i.test(url.pathname)) {
    throw new Error('Refusing destructive test setup: use a test database named *_test or *_test_<suffix>');
  }
  if (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public') {
    throw new Error('Refusing destructive test setup: test schema must be public');
  }
  return url;
}
