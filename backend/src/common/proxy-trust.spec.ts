import { proxyHopsFrom } from './proxy-trust';

describe('proxyHopsFrom', () => {
  it('trusts the hops a deployment declares', () => {
    expect(proxyHopsFrom({ TRUST_PROXY_HOPS: '1' })).toBe(1);
    expect(proxyHopsFrom({ TRUST_PROXY_HOPS: '2' })).toBe(2);
  });

  /**
   * Running without a proxy must be safe by default. Trusting a forwarded
   * header nobody sets lets any caller claim any address and get a fresh
   * rate-limit bucket per request.
   */
  it.each([
    { label: 'unset', env: {} },
    { label: 'empty', env: { TRUST_PROXY_HOPS: '' } },
    { label: 'whitespace', env: { TRUST_PROXY_HOPS: '   ' } },
    { label: 'zero', env: { TRUST_PROXY_HOPS: '0' } },
  ])('trusts nothing when $label', ({ env }) => {
    expect(proxyHopsFrom(env)).toBe(0);
  });

  // Getting this wrong permissively is the exploitable direction, so anything
  // unparseable has to fail closed.
  it.each(['yes', 'true', 'NaN', '1.5', '-1', '1e3', 'Infinity'])(
    'trusts nothing for %s',
    (value) => {
      expect(proxyHopsFrom({ TRUST_PROXY_HOPS: value })).toBe(0);
    },
  );

  // Treating a typo as a real chain length would trust hops a caller controls.
  it('caps an implausible count', () => {
    expect(proxyHopsFrom({ TRUST_PROXY_HOPS: '99' })).toBe(4);
  });
});
