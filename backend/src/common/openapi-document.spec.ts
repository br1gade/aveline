import type { OpenAPIObject } from '@nestjs/swagger';
import { completeOpenApiDocument } from './openapi-document';

const documentWith = (paths: OpenAPIObject['paths']): OpenAPIObject => ({ openapi: '3.0.0', info: { title: 't', version: '1' }, paths });

describe('completeOpenApiDocument', () => {
  // A controller reading `@Param() params` or relying on a guard for the id
  // left the parameter out, and generated clients refused the path (FR-44).
  it('declares every templated path parameter the controller did not', () => {
    const document = completeOpenApiDocument(documentWith({
      '/events/{eventId}/drafts/{draftId}': { post: { responses: {}, parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string' } }] } },
    }));

    expect(document.paths['/events/{eventId}/drafts/{draftId}'].post?.parameters).toEqual([
      { name: 'eventId', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'draftId', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });

  // HTTP header names are case-insensitive; `@ApiHeader('Idempotency-Key')`
  // beside `@Headers('idempotency-key')` declared the same header twice.
  const described = { name: 'Idempotency-Key', in: 'header' as const, required: true, description: '8–128 characters' };
  const bare = { name: 'idempotency-key', in: 'header' as const, required: true, schema: { type: 'string' as const } };
  const others = [{ name: 'locale', in: 'query' as const, required: false }, { name: 'x-request-id', in: 'header' as const }];

  it.each([['first', [described, bare]], ['second', [bare, described]]])(
    'keeps the described declaration of a header named twice when it comes %s, and every other parameter',
    (_, duplicates) => {
      const document = completeOpenApiDocument(documentWith({ '/enquiries': { post: { responses: {}, parameters: [...others, ...duplicates] } } }));

      expect(document.paths['/enquiries'].post?.parameters).toEqual([...others, described]);
    },
  );
});
