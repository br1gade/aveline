import { TelegramSettings, TelegramTransport } from './telegram.transport';

const settings: TelegramSettings = { botToken: 'test-token', apiBaseUrl: 'https://api.test' };

/** A fetch that answers with one Bot API reply and records the request. */
function fakeFetch(reply: Record<string, unknown>, status = 200) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];

  const impl = (url: string, init?: { body?: string }) => {
    calls.push({ url, body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> });
    return Promise.resolve({
      status,
      json: () => Promise.resolve(reply),
    } as Response);
  };

  return { impl, calls };
}

const message = { toAddress: '123456789', body: 'Բարև', locale: 'hy' };

describe('TelegramTransport', () => {
  it('posts the text to the chat id', async () => {
    const { impl, calls } = fakeFetch({ ok: true, result: { message_id: 42 } });

    await new TelegramTransport(settings, impl).send(message);

    expect(calls[0].url).toBe('https://api.test/bottest-token/sendMessage');
    expect(calls[0].body).toMatchObject({ chat_id: '123456789', text: 'Բարև' });
  });

  /**
   * Template copy is authored by hosts and rendered with guest-supplied
   * values. Asking Telegram to parse it as Markdown would let a stray bracket
   * break the send, or inject formatting into every guest's message.
   */
  it('sends plain text, with no parse mode', async () => {
    const { impl, calls } = fakeFetch({ ok: true, result: { message_id: 1 } });

    await new TelegramTransport(settings, impl).send(message);

    expect(calls[0].body).not.toHaveProperty('parse_mode');
  });

  // Telegram accepting a message means it reaches the device; there is no
  // later bounce, unlike email.
  it('reports delivery, not merely acceptance', async () => {
    const { impl } = fakeFetch({ ok: true, result: { message_id: 42 } });

    const result = await new TelegramTransport(settings, impl).send(message);

    expect(result).toEqual({ providerRef: '42', isDelivered: true });
  });

  describe('failures the dispatcher has to classify', () => {
    /**
     * 403 is the guest blocking the bot and 400 is "chat not found" — a
     * deleted account or a wrong id. Both are permanent, and the classifier
     * reads them as such through the 5xx range it already understands.
     */
    it.each([
      { code: 403, description: 'Forbidden: bot was blocked by the user' },
      { code: 400, description: 'Bad Request: chat not found' },
    ])('maps $code to a permanent failure', async ({ code, description }) => {
      const { impl } = fakeFetch({ ok: false, error_code: code, description });

      await expect(new TelegramTransport(settings, impl).send(message)).rejects.toMatchObject({
        responseCode: 550,
      });
    });

    // Rate limiting is temporary however emphatic it sounds.
    it.each([429, 500, 502])('maps %s to a temporary failure', async (code) => {
      const { impl } = fakeFetch({ ok: false, error_code: code, description: 'Too Many Requests' });

      await expect(new TelegramTransport(settings, impl).send(message)).rejects.toMatchObject({
        responseCode: 451,
      });
    });

    it('carries Telegram’s own words as the reason', async () => {
      const { impl } = fakeFetch({
        ok: false,
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      });

      await expect(new TelegramTransport(settings, impl).send(message)).rejects.toThrow(
        /blocked by the user/,
      );
    });

    // A reply with ok:false and nothing else must still fail, not succeed.
    it('fails on an unexplained rejection', async () => {
      const { impl } = fakeFetch({ ok: false });

      await expect(new TelegramTransport(settings, impl).send(message)).rejects.toBeDefined();
    });
  });
});
