import { allowsDevelopmentShortcuts } from './environment';

describe('allowsDevelopmentShortcuts', () => {
  it.each(['development', 'test'])('allows them when NODE_ENV says %s outright', (nodeEnv) => {
    expect(allowsDevelopmentShortcuts(nodeEnv)).toBe(true);
  });

  // Fails closed: anything that is not an explicit development value is production.
  it.each(['production', undefined, '', 'prod', 'staging', 'Development'])('refuses them for %p', (nodeEnv) => {
    expect(allowsDevelopmentShortcuts(nodeEnv)).toBe(false);
  });
});
