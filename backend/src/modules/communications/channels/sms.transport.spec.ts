import { SmsProvider, SmsTransport, toE164 } from './sms.transport';

describe('toE164', () => {
  it.each([
    ['+374 91 000000', '+37491000000'],
    ['+374-91-000-000', '+37491000000'],
    ['00374 91 000000', '+37491000000'],
    ['091 000000', '+37491000000'],
    ['(091) 00-00-00', '+37491000000'],
    ['+1 (415) 555-0100', '+14155550100'],
  ])('reads %p as %p', (raw, expected) => {
    expect(toE164(raw, '374')).toBe(expected);
  });

  // No leading +, 00 or 0: there is no telling which country it is in.
  it.each(['91 000000', 'call me', '+374', '+12345678901234567'])('refuses %p', (raw) => {
    expect(toE164(raw, '374')).toBeNull();
  });
});

describe('SmsTransport', () => {
  const provider = (): SmsProvider & { sent: [string, string][] } => {
    const sent: [string, string][] = [];
    return {
      name: 'test',
      sent,
      send: (to, text) => {
        sent.push([to, text]);
        return Promise.resolve({ providerRef: `sms-${sent.length}` });
      },
    };
  };

  it('sends the body to the number in international form', async () => {
    const sms = provider();
    const transport = new SmsTransport({ provider: sms, defaultCountryCode: '374' });

    const result = await transport.send({ toAddress: '091 000000', body: 'Dear Ani', locale: 'hy' });

    expect(sms.sent).toEqual([['+37491000000', 'Dear Ani']]);
    expect(result).toEqual({ providerRef: 'sms-1', isDelivered: false });
  });

  it('refuses a number it cannot dial as undeliverable, without calling the provider', async () => {
    const sms = provider();
    const transport = new SmsTransport({ provider: sms, defaultCountryCode: '374' });

    await expect(transport.send({ toAddress: '91 000000', body: 'x', locale: 'hy' })).rejects.toMatchObject({
      responseCode: 550,
    });
    expect(sms.sent).toEqual([]);
  });
});
