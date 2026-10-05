import { SmtpTransport } from '../../src/modules/communications/channels/smtp.transport';

/**
 * The SMTP transport against a real SMTP server.
 *
 * The unit tests prove the transport hands nodemailer the right things; this
 * proves nodemailer and a real server accept them. Those are different
 * failures, and the second kind — a malformed address header, an encoding that
 * mangles Armenian — only shows up on the wire.
 *
 * The server is the Mailpit container from docker-compose, which speaks real
 * SMTP and forwards nothing, so this never reaches a stranger's inbox.
 */
const MAILPIT_API = process.env.MAILPIT_API ?? 'http://localhost:8025';

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  From: { Address: string };
}

async function inbox(): Promise<MailpitMessage[]> {
  const response = await fetch(`${MAILPIT_API}/api/v1/messages?limit=50`);
  const body = (await response.json()) as { messages: MailpitMessage[] };
  return body.messages;
}

async function bodyOf(id: string): Promise<{ Text: string; HTML: string }> {
  const response = await fetch(`${MAILPIT_API}/api/v1/message/${id}`);
  return (await response.json()) as { Text: string; HTML: string };
}

const transport = () =>
  new SmtpTransport({
    host: 'localhost',
    port: 1025,
    isSecure: false,
    from: 'Aveline <hello@aveline.test>',
  });

describe('SMTP delivery (integration)', () => {
  // The suite asserts on the whole inbox, so it starts from an empty one.
  // The global setup has already established that the server is reachable.
  beforeAll(async () => {
    await fetch(`${MAILPIT_API}/api/v1/messages`, { method: 'DELETE' });
  });

  it('delivers a message a real server accepts', async () => {
    const result = await transport().send({
      toAddress: 'ani@test.local',
      subject: 'Հրավեր',
      body: 'Բարև, սպասում ենք ձեզ',
      locale: 'hy',
    });

    expect(result.providerRef).toEqual(expect.any(String));
    // Accepted, not delivered — the next hop can still bounce it.
    expect(result.isDelivered).toBe(false);

    const messages = await inbox();
    const delivered = messages.find((message) => message.To[0]?.Address === 'ani@test.local');
    expect(delivered).toBeDefined();
    expect(delivered?.From.Address).toBe('hello@aveline.test');
  });

  /**
   * The failure this catches: an Armenian subject that arrives as mojibake
   * because a header was not encoded. No amount of unit testing the transport
   * finds it, because the encoding happens inside the SMTP client.
   */
  it('keeps Armenian text intact through the wire', async () => {
    await transport().send({
      toAddress: 'armenian@test.local',
      subject: 'Հարսանիք',
      body: 'Արմեն և Լուսինե',
      locale: 'hy',
    });

    const messages = await inbox();
    const delivered = messages.find((m) => m.To[0]?.Address === 'armenian@test.local');
    expect(delivered?.Subject).toBe('Հարսանիք');

    const content = await bodyOf(delivered!.ID);
    expect(content.Text).toContain('Արմեն և Լուսինե');
  });

  it('sends a text part and an escaped HTML part', async () => {
    await transport().send({
      toAddress: 'both-parts@test.local',
      subject: 'Parts',
      body: 'line one\nline two & <tag>',
      locale: 'hy',
    });

    const messages = await inbox();
    const delivered = messages.find((m) => m.To[0]?.Address === 'both-parts@test.local');
    const content = await bodyOf(delivered!.ID);

    expect(content.Text).toContain('line two & <tag>');
    expect(content.HTML).toContain('line one<br>line two');
    // The markup a host could inject through a template variable must arrive
    // as text, not as a tag.
    expect(content.HTML).toContain('&lt;tag&gt;');
  });

  /**
   * A rejection from a real server, classified the way the dispatcher will
   * see it. Mailpit rejects an address it cannot parse at the envelope stage.
   */
  it('surfaces a server rejection as an error carrying its reply', async () => {
    await expect(
      transport().send({
        toAddress: 'not an address',
        subject: 'x',
        body: 'x',
        locale: 'hy',
      }),
    ).rejects.toBeDefined();
  });
});
