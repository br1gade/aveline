import { ArgumentsHost, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * What a client is told when something goes wrong that is not an HTTP
 * exception. An internal message can name tables, columns or configuration,
 * so only the mapped Prisma codes say anything at all.
 */
describe('AllExceptionsFilter masking', () => {
  const caught = (exception: unknown) => {
    const json = jest.fn();
    const response = { status: jest.fn().mockReturnValue({ json }) };
    const request = { headers: { 'accept-language': 'en' }, url: '/api/v1/events/abc/guests', method: 'POST', requestId: 'req-1' };
    const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }) };
    new AllExceptionsFilter().catch(exception, host as unknown as ArgumentsHost);
    return { status: response.status.mock.calls[0][0] as number, body: json.mock.calls[0][0] as Record<string, unknown> };
  };

  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`) in table `users`', {
      code, clientVersion: 'test', meta: { target: ['email'], modelName: 'User' },
    });

  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('answers an unrecognised error with a bare 500 that names nothing internal', () => {
    const { status, body } = caught(new Error('column "passwordHash" of relation "users" does not exist'));

    expect(status).toBe(500);
    expect(body).toMatchObject({ statusCode: 500, message: 'Internal server error', code: 'INTERNAL_ERROR', requestId: 'req-1' });
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|relation|users"|stack/);
  });

  it('answers a thrown non-Error value the same way', () => {
    const { status, body } = caught('database password is hunter2');

    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it.each([
    ['P2002', 409, 'That value is already taken'],
    ['P2003', 400, 'Referenced record does not exist'],
    ['P2025', 404, 'Record not found'],
  ])('maps Prisma %s to %i with a generic message', (code, expectedStatus, message) => {
    const { status, body } = caught(prismaError(code));

    expect(status).toBe(expectedStatus);
    expect(body).toMatchObject({ statusCode: expectedStatus, message });
    expect(JSON.stringify(body)).not.toMatch(/Unique constraint|`email`|users/);
  });

  it.each(['P2000', 'P2010', 'P2034'])('answers unmapped Prisma %s as a masked 500', (code) => {
    const { status, body } = caught(prismaError(code));

    expect(status).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toMatch(/Unique constraint|email|P20/);
  });

  it('logs the real cause for a 500 but not for a mapped client error', () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    caught(prismaError('P2002'));
    expect(logged).not.toHaveBeenCalled();
    caught(new Error('relation "users" does not exist'));

    expect(logged).toHaveBeenCalledWith(expect.stringContaining('500 [req-1]'), expect.stringContaining('relation "users" does not exist'));
  });
});
