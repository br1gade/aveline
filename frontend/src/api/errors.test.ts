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

describe('the feedback beside the message', () => {
  const conflict = new Response(null, { status: 409 });

  it('keeps the code, the action, the generic sentence and each field', () => {
    const error = apiErrorFrom(new Response(null, { status: 400 }), {
      message: ['name must be shorter than or equal to 160 characters'],
      code: 'VALIDATION_FAILED',
      action: 'EDIT',
      userMessage: 'Check the highlighted fields.',
      details: [
        { field: 'name', code: 'INVALID_LENGTH', userMessage: 'Too long.' },
        { field: null, code: 'INVALID_FIELD', userMessage: 'Check this.' },
      ],
    });
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.action).toBe('EDIT');
    expect(error.userMessage).toBe('Check the highlighted fields.');
    expect(error.details).toEqual([
      { field: 'name', code: 'INVALID_LENGTH', userMessage: 'Too long.' },
      { field: null, code: 'INVALID_FIELD', userMessage: 'Check this.' },
    ]);
  });

  it('tells an attendance change from any other conflict', () => {
    const changed = apiErrorFrom(conflict, {
      message: 'attendanceRevision: attendance policy changed; reload the invitation and reconfirm',
      code: 'ATTENDANCE_CHANGED',
      action: 'RELOAD',
    });
    expect(changed.code).toBe('ATTENDANCE_CHANGED');
    expect(apiErrorFrom(conflict, { code: 'CONFLICT' }).code).toBe('CONFLICT');
  });

  it('ignores anything it does not recognise, and works without any of it', () => {
    const odd = apiErrorFrom(conflict, {
      message: { status: 'down' },
      code: 409,
      action: null,
      details: [{ field: 3 }, 'x', null, { field: 'a', code: 'B', userMessage: 'c' }],
    });
    expect(odd.messages).toEqual([]);
    expect(odd.code).toBeUndefined();
    expect(odd.action).toBeUndefined();
    expect(odd.details).toEqual([{ field: 'a', code: 'B', userMessage: 'c' }]);

    const bare = apiErrorFrom(conflict, 'plain text');
    expect(bare.code).toBeUndefined();
    expect(bare.details).toEqual([]);
  });
});
