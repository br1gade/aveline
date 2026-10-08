import type { IncomingMessage, ServerResponse } from 'node:http';
import { loggingConfig } from './logging.config';

/**
 * Logging is the thing you only find out is wrong during an incident, so the
 * two properties worth pinning are that secrets never reach a line and that
 * severity matches whose fault a failure was.
 */
describe('loggingConfig', () => {
  /** The shape this spec asserts on. pino-http's own type is a union that
   *  does not narrow usefully here. */
  interface PinoOptions {
    level: string;
    transport?: { target: string };
    redact: { paths: string[] };
    customLogLevel: (req: IncomingMessage, res: ServerResponse, error?: Error) => string;
    genReqId: (req: IncomingMessage) => string;
    autoLogging: { ignore: (req: IncomingMessage) => boolean };
    serializers: { req: (req: Record<string, unknown>) => Record<string, unknown> };
  }

  const config = (env: Record<string, string> = {}) =>
    loggingConfig(env).pinoHttp as unknown as PinoOptions;

  describe('level', () => {
    it('defaults to info in production and debug elsewhere', () => {
      expect(config({ NODE_ENV: 'production' }).level).toBe('info');
      expect(config({}).level).toBe('debug');
    });

    it('honours an explicit LOG_LEVEL', () => {
      expect(config({ NODE_ENV: 'production', LOG_LEVEL: 'warn' }).level).toBe('warn');
    });
  });

  describe('output shape', () => {
    it('emits JSON in production so a shipper can parse it', () => {
      expect(config({ NODE_ENV: 'production' }).transport).toBeUndefined();
    });

    it('pretty-prints elsewhere, where a human reads it', () => {
      expect(config({}).transport).toMatchObject({ target: 'pino-pretty' });
    });
  });

  describe('redaction', () => {
    it.each([
      'req.headers.authorization',
      'req.body.password',
      'req.body.refreshToken',
      'req.body.email',
      'req.headers["x-telegram-bot-api-secret-token"]',
    ])('never logs %s', (path) => {
      expect(config().redact.paths).toContain(path);
    });

    /**
     * Every request line used to carry the full URL and its path parameters,
     * so the logs were a list of working guest, ticket and brief links.
     */
    it('never writes a capability link or a searched name into a request line', () => {
      const serialize = config().serializers.req;
      const line = serialize({
        method: 'POST',
        url: '/api/v1/invitations/anna-davit/g/k7m2abcd9xyz/rsvp?q=Armen',
        params: { splat: ['invitations', 'anna-davit', 'g', 'k7m2abcd9xyz', 'rsvp'] },
        query: { q: 'Armen', locale: 'hy' },
      });

      expect(JSON.stringify(line)).not.toContain('k7m2abcd9xyz');
      expect(JSON.stringify(line)).not.toContain('Armen');
      expect(line).toMatchObject({
        method: 'POST',
        url: '/api/v1/invitations/anna-davit/g/[token]/rsvp?q=[redacted]',
        query: { q: '[redacted]', locale: 'hy' },
      });
    });
  });

  describe('severity', () => {
    const level = (statusCode: number, error?: Error) =>
      config().customLogLevel({} as IncomingMessage, { statusCode } as ServerResponse, error);

    // A 404 is the caller asking for something that is not there. Logging it
    // as an error turns real incidents into noise nobody reads.
    it.each([
      { statusCode: 200, expected: 'info' },
      { statusCode: 400, expected: 'warn' },
      { statusCode: 404, expected: 'warn' },
      { statusCode: 500, expected: 'error' },
      { statusCode: 503, expected: 'error' },
    ])('logs $statusCode as $expected', ({ statusCode, expected }) => {
      expect(level(statusCode)).toBe(expected);
    });

    it('logs as an error when the handler threw, whatever the status', () => {
      expect(level(200, new Error('boom'))).toBe('error');
    });
  });

  describe('request ids', () => {
    const genReqId = (headers: Record<string, unknown>) =>
      config().genReqId({ headers } as IncomingMessage);

    it('reuses an id supplied upstream, so a trace survives a proxy', () => {
      expect(genReqId({ 'x-request-id': 'from-upstream' })).toBe('from-upstream');
    });

    it('generates one when none is supplied', () => {
      expect(genReqId({})).toMatch(/[0-9a-f-]{36}/);
    });

    it('rejects an absurdly long header rather than logging it', () => {
      expect(genReqId({ 'x-request-id': 'x'.repeat(500) })).toMatch(/[0-9a-f-]{36}/);
    });
  });

  describe('noise', () => {
    it('does not log health checks, which would drown everything else', () => {
      const ignore = config().autoLogging.ignore;
      expect(ignore({ url: '/api/v1/health/live' } as IncomingMessage)).toBe(true);
      expect(ignore({ url: '/api/v1/events' } as IncomingMessage)).toBe(false);
    });
  });
});
