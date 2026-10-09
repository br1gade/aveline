import { WhatsAppSettings, WhatsAppTransport, toE164 } from './whatsapp.transport';

const settings: WhatsAppSettings = {
  phoneNumberId: '1234567890',
  accessToken: 'test-token',
  apiBaseUrl: 'https://graph.test',
  apiVersion: 'v21.0',
};

/** What our transports actually send: a string URL and a JSON string body. */
function readRequest(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof input !== 'string') throw new TypeError('the fake expects a string URL');
  if (init?.body !== undefined && typeof init.body !== 'string') {
    throw new TypeError('the fake expects a string body');
  }
  return { url: input, body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> };
}

function fakeFetch(reply: Record<string, unknown>, ok = true, status = 200) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];

  const impl: typeof fetch = (input, init) => {
    calls.push({
      ...readRequest(input, init),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return Promise.resolve({ ok, status, json: () => Promise.resolve(reply) } as Response);
  };

  return { impl, calls };
}

const templated = {
  toAddress: '+374 10 000000',
  body: 'Հարգելի Armen, սիրով հրավիրում ենք',
  locale: 'hy',
  template: { providerTemplate: 'invitation_v1', params: ['Armen', 'A & B', 'https://x/y'] },
};

describe('WhatsAppTransport', () => {
  it('sends the registered template with its positional parameters', async () => {
    const { impl, calls } = fakeFetch({ messages: [{ id: 'wamid.123' }] });

    await new WhatsAppTransport(settings, impl).send(templated);

    expect(calls[0].url).toBe('https://graph.test/v21.0/1234567890/messages');
    expect(calls[0].body).toMatchObject({
      messaging_product: 'whatsapp',
      type: 'template',
      template: {
        name: 'invitation_v1',
        language: { code: 'hy' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Armen' },
              { type: 'text', text: 'A & B' },
              { type: 'text', text: 'https://x/y' },
            ],
          },
        ],
      },
    });
  });

  it('authenticates with the access token', async () => {
    const { impl, calls } = fakeFetch({ messages: [{ id: 'wamid.1' }] });

    await new WhatsAppTransport(settings, impl).send(templated);

    expect(calls[0].headers.authorization).toBe('Bearer test-token');
  });

  /**
   * Meta reports delivery and read receipts later through a webhook we do not
   * consume, so claiming delivery here would be a guess.
   */
  it('reports acceptance, not delivery', async () => {
    const { impl } = fakeFetch({ messages: [{ id: 'wamid.123' }] });

    const result = await new WhatsAppTransport(settings, impl).send(templated);

    expect(result).toEqual({ providerRef: 'wamid.123', isDelivered: false });
  });

  /**
   * Sending free text would be rejected by Meta anyway; failing here says
   * what is actually wrong — our template is missing its provider mapping.
   */
  it('refuses a message with no registered template', async () => {
    const { impl, calls } = fakeFetch({ messages: [{ id: 'x' }] });

    await expect(
      new WhatsAppTransport(settings, impl).send({
        toAddress: '+37410000000',
        body: 'free text',
        locale: 'hy',
      }),
    ).rejects.toThrow(/providerTemplate/);
    expect(calls).toHaveLength(0);
  });

  describe('failures the dispatcher has to classify', () => {
    // No retrying makes someone a WhatsApp user, and the address should stop
    // being tried.
    it.each([
      { code: 131026, label: 'not a WhatsApp user' },
      { code: 131049, label: 'blocked by privacy settings' },
    ])('maps $code ($label) to a permanent failure', async ({ code }) => {
      const { impl } = fakeFetch({ error: { code, message: 'rejected' } }, false, 400);

      await expect(new WhatsAppTransport(settings, impl).send(templated)).rejects.toMatchObject({
        responseCode: 550,
      });
    });

    // B20: a template problem is ours. Read as the guest's hard bounce, it
    // suppressed their number platform-wide, where no host could lift it.
    it.each([
      { code: 132000, label: 'template parameter count mismatch' },
      { code: 132001, label: 'template does not exist' },
      { code: 132015, label: 'template paused for quality' },
    ])('maps $code ($label) to our misconfiguration, never the guest’s', async ({ code }) => {
      const { impl } = fakeFetch({ error: { code, message: 'rejected' } }, false, 400);

      const failure = new WhatsAppTransport(settings, impl).send(templated);

      await expect(failure).rejects.toMatchObject({ code: 'ECONFIG' });
      await expect(failure).rejects.not.toHaveProperty('responseCode', 550);
    });

    // Our own rate limit must not cost a guest their invitation.
    it.each([131048, 130429, 500])('maps %s to a temporary failure', async (code) => {
      const { impl } = fakeFetch({ error: { code, message: 'throttled' } }, false, 429);

      await expect(new WhatsAppTransport(settings, impl).send(templated)).rejects.toMatchObject({
        responseCode: 451,
      });
    });

    /**
     * An expired token is ours. It must be flagged as a misconfiguration so it
     * is logged loudly and never held against the recipient.
     */
    it.each([190, 10, 200])('maps %s to a misconfiguration', async (code) => {
      const { impl } = fakeFetch({ error: { code, message: 'token expired' } }, false, 401);

      await expect(new WhatsAppTransport(settings, impl).send(templated)).rejects.toMatchObject({
        code: 'EAUTH',
      });
    });

    it('fails on a non-OK response with no error body', async () => {
      const { impl } = fakeFetch({}, false, 503);

      await expect(new WhatsAppTransport(settings, impl).send(templated)).rejects.toBeDefined();
    });
  });
});

describe('toE164', () => {
  // Meta wants digits only; a host types a number however they like.
  it.each([
    { raw: '+374 10 000000', expected: '37410000000' },
    { raw: '+374-10-000000', expected: '37410000000' },
    { raw: '(374) 10 000000', expected: '37410000000' },
    { raw: '37410000000', expected: '37410000000' },
  ])('normalises $raw', ({ raw, expected }) => {
    expect(toE164(raw)).toBe(expected);
  });
});
