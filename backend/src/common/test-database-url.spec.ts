import { assertTestDatabaseUrl } from './test-database-url';

describe('test database isolation', () => {
  it.each(['aveline', 'postgres', 'aveline_test;DROP_DATABASE', 'aveline_test/other'])(
    'refuses destructive test setup against %s', (database) => {
      expect(() => assertTestDatabaseUrl(`postgresql://owner:secret@localhost/${database}`, 'test')).toThrow(/test database/);
    },
  );

  it.each(['aveline_test', 'aveline_test_ci'])('allows a disposable database named %s', (database) => {
    expect(assertTestDatabaseUrl(`postgresql://owner:secret@postgres/${database}?schema=public`, 'test').pathname).toBe(`/${database}`);
  });

  it('refuses destructive setup inside a production process', () => {
    expect(() => assertTestDatabaseUrl('postgresql://localhost/aveline_test', 'production')).toThrow(/production/);
  });

  it('refuses a different schema instead of truncating public anyway', () => {
    expect(() => assertTestDatabaseUrl('postgresql://localhost/aveline_test?schema=other', 'test')).toThrow(/schema/);
  });

  it('does not expose credentials in an invalid-target error', () => {
    expect(() => assertTestDatabaseUrl('postgresql://owner:secret@localhost/aveline', 'test')).toThrow('Refusing destructive test setup: use a test database named *_test or *_test_<suffix>');
  });
});
