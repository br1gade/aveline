import type { Transporter } from 'nodemailer';
import { SmtpSettings, SmtpTransport, asHtml } from './smtp.transport';

const settings: SmtpSettings = {
  host: 'localhost',
  port: 1025,
  isSecure: false,
  from: 'Aveline <hello@aveline.test>',
};

/** Stands in for nodemailer, recording what it was handed. */
function fakeTransporter(result: Record<string, unknown>) {
  const calls: Record<string, unknown>[] = [];
  const transporter = {
    sendMail: (options: Record<string, unknown>) => {
      calls.push(options);
      return Promise.resolve(result);
    },
    close: () => undefined,
  } as unknown as Transporter;

  return { transporter, calls };
}

describe('SmtpTransport', () => {
  it('sends from the configured address to the recipient', async () => {
    const { transporter, calls } = fakeTransporter({
      accepted: ['ani@test.local'],
      messageId: '<abc@aveline>',
    });

    await new SmtpTransport(settings, transporter).send({
      toAddress: 'ani@test.local',
      subject: 'Հրավեր',
      body: 'Բարև',
      locale: 'hy',
    });

    expect(calls[0]).toMatchObject({
      from: 'Aveline <hello@aveline.test>',
      to: 'ani@test.local',
      subject: 'Հրավեր',
      text: 'Բարև',
    });
  });

  /**
   * SMTP acceptance is not delivery — the next hop can still bounce it — so
   * reporting `isDelivered` here would claim something we do not know.
   */
  it('reports acceptance, not delivery', async () => {
    const { transporter } = fakeTransporter({
      accepted: ['ani@test.local'],
      messageId: '<abc@aveline>',
    });

    const result = await new SmtpTransport(settings, transporter).send({
      toAddress: 'ani@test.local',
      body: 'Բարև',
      locale: 'hy',
    });

    expect(result).toEqual({ providerRef: '<abc@aveline>', isDelivered: false });
  });

  // Neither accepted nor rejected is not a success; treating it as one loses
  // the message with no trace.
  it.each([
    { label: 'an empty accepted list', info: { accepted: [], response: '451 deferred' } },
    { label: 'no accepted list at all', info: { response: '451 deferred' } },
  ])('throws a retryable error on $label', async ({ info }) => {
    const { transporter } = fakeTransporter(info);

    await expect(
      new SmtpTransport(settings, transporter).send({
        toAddress: 'ani@test.local',
        body: 'Բարև',
        locale: 'hy',
      }),
    ).rejects.toMatchObject({ responseCode: 451 });
  });

  // The dispatcher needs the provider's own error to classify it.
  it('lets a provider error through untouched', async () => {
    const rejection = Object.assign(new Error('550 no such user'), { responseCode: 550 });
    const transporter = {
      sendMail: () => Promise.reject(rejection),
      close: () => undefined,
    } as unknown as Transporter;

    await expect(
      new SmtpTransport(settings, transporter).send({
        toAddress: 'ani@test.local',
        body: 'Բարև',
        locale: 'hy',
      }),
    ).rejects.toBe(rejection);
  });

  it('sends an empty subject rather than undefined', async () => {
    const { transporter, calls } = fakeTransporter({ accepted: ['x@y.z'], messageId: '<a>' });

    await new SmtpTransport(settings, transporter).send({
      toAddress: 'x@y.z',
      body: 'Բարև',
      locale: 'hy',
    });

    expect(calls[0].subject).toBe('');
  });
});

/**
 * A reply must reach someone who reads it, and a guest must be able to stop
 * a host's mail from the mail client itself (audit F-10).
 */
describe('SmtpTransport headers', () => {
  const sent = async (overrides: Partial<SmtpSettings>, message: { unsubscribeUrl?: string } = {}) => {
    const { transporter, calls } = fakeTransporter({ accepted: ['ani@test.local'] });
    await new SmtpTransport({ ...settings, ...overrides }, transporter).send({ toAddress: 'ani@test.local', body: 'Բարև', locale: 'hy', ...message });
    return calls[0];
  };

  it('sends replies to the support address', async () => {
    expect(await sent({ replyTo: 'support@aveline.test' })).toMatchObject({ replyTo: 'support@aveline.test' });
  });

  it('offers one-click unsubscribe when the message carries a link', async () => {
    const url = 'https://aveline.test/api/v1/email-unsubscribe/m1/sig';
    expect((await sent({}, { unsubscribeUrl: url })).headers).toEqual({
      'List-Unsubscribe': `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('adds no unsubscribe header to mail a person cannot opt out of, such as a password reset', async () => {
    expect((await sent({})).headers).toBeUndefined();
  });
});

describe('asHtml', () => {
  it('keeps line breaks', () => {
    expect(asHtml('one\ntwo')).toContain('one<br>two');
  });

  /**
   * A host types a guest's name into a template variable, and that text ends
   * up in every other guest's email. Unescaped, one apostrophe-and-angle
   * bracket away from injecting markup.
   */
  it.each([
    { raw: '<script>alert(1)</script>', absent: '<script>' },
    { raw: 'Ani & Armen', absent: 'Ani & Armen' },
    { raw: '"quoted"', absent: '"quoted"' },
  ])('escapes $raw', ({ raw, absent }) => {
    const html = asHtml(raw);

    expect(html.replace(/^<div[^>]*>|<\/div>$/g, '')).not.toContain(absent);
  });

  it('escapes the ampersand first, so an escape is not double-escaped', () => {
    expect(asHtml('&lt;')).toContain('&amp;lt;');
  });

  it('leaves Armenian text alone', () => {
    expect(asHtml('Բարև')).toContain('Բարև');
  });
});
