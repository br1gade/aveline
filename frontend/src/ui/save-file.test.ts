import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveFile } from './save-file';

describe('handing the browser a fetched file to save', () => {
  const created = vi.fn((_blob: Blob) => 'blob:http://app.test/1');
  const revoked = vi.fn((_url: string) => undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    created.mockClear();
    revoked.mockClear();
  });

  it('clicks a link to an object URL under the name given, then leaves nothing behind', () => {
    const clicked: Array<{ href: string; download: string }> = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download });
    });
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });

    saveFile(blob, 'guest-list-c1.pdf');

    expect(created).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([{ href: 'blob:http://app.test/1', download: 'guest-list-c1.pdf' }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoked).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoked).toHaveBeenCalledWith('blob:http://app.test/1');
    click.mockRestore();
  });
});
