// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { publicOperations, publicPathsSource } from './public-paths.mjs';

const spec = {
  paths: {
    '/api/v1/auth/login': { post: { security: [] } },
    '/api/v1/events': { get: { security: [{ bearer: [] }] }, post: { security: [{ bearer: [] }] } },
    '/api/v1/briefs/{briefToken}': { get: { security: [] }, parameters: [] },
    '/api/v1/mixed': { get: { security: [] }, delete: { security: [{ bearer: [] }] } },
    '/api/v1/undeclared': { get: {} },
  },
};

describe('the operations a public client may call (FR-2)', () => {
  it('takes only those declared `security: []`, by method', () => {
    expect(publicOperations(spec)).toEqual({
      '/api/v1/auth/login': ['post'],
      '/api/v1/briefs/{briefToken}': ['get'],
      '/api/v1/mixed': ['get'],
    });
  });

  it('writes them as a type over the generated paths, nothing else', () => {
    const source = publicPathsSource(spec);
    expect(source).toContain(
      `'/api/v1/mixed': Pick<paths['/api/v1/mixed'], 'parameters' | 'get'>;`,
    );
    expect(source).not.toContain('/api/v1/events');
    expect(source).not.toContain('/api/v1/undeclared');
  });
});
