import { describe, expect, it } from 'vitest';

import { ApiError, apiErrorFrom, messagesFrom } from './errors';

describe('ApiError', () => {
  it('accepts a message as a string or an array', () => {
    expect(messagesFrom({ message: 'No event abc' })).toEqual(['No event abc']);
    expect(messagesFrom({ message: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(messagesFrom(null)).toEqual([]);
  });

  it('maps "field: message" entries onto fields and keeps the rest for the form', () => {
    const error = new ApiError({
      status: 400,
      messages: ['members: Lusine must have a status', 'answers: q1 is required', 'Something else'],
    });
    expect(error.fieldErrors).toEqual({
      members: ['Lusine must have a status'],
      answers: ['q1 is required'],
    });
    expect(error.formErrors).toEqual(['Something else']);
  });

  it('never keeps a capability token in the path', () => {
    const error = new ApiError({
      status: 404,
      messages: [],
      path: '/api/v1/invitations/anna-davit/g/s3cret/rsvp',
    });
    expect(error.path).toBe('/api/v1/invitations/anna-davit/g/[token]/rsvp');
  });

  it('takes the request id from the response, then the body, then our own', () => {
    const withHeader = new Response(null, {
      status: 500,
      headers: { 'x-request-id': 'from-header' },
    });
    expect(apiErrorFrom(withHeader, { requestId: 'from-body' }, 'ours').requestId).toBe(
      'from-header',
    );

    const bare = new Response(null, { status: 500 });
    expect(apiErrorFrom(bare, { requestId: 'from-body' }, 'ours').requestId).toBe('from-body');
    expect(apiErrorFrom(bare, {}, 'ours').requestId).toBe('ours');
  });
});
