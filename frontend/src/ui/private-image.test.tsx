import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/errors';

import { PrivateImage } from './private-image';

const TOKEN = `tok-${crypto.randomUUID()}`;
const picture = new Blob(['webp'], { type: 'image/webp' });

function failed(retry: () => void) {
  return (
    <button type="button" onClick={retry}>
      Try again
    </button>
  );
}

afterEach(() => vi.restoreAllMocks());

describe('a private picture', () => {
  it('is shown from an object URL, never from the address it was read at', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test/photo');
    const asked: string[] = [];
    const load = vi.fn(() => {
      asked.push(`/api/v1/invitations/anna-davit/g/${TOKEN}/gallery/m1/file`);
      return Promise.resolve(picture);
    });
    const { container } = render(
      <PrivateImage id="m1" load={load} alt="A photo from a guest" renderFailed={failed} />,
    );
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'A photo from a guest' })).toHaveAttribute(
        'src',
        'blob:test/photo',
      ),
    );
    expect(create).toHaveBeenCalledWith(picture);
    expect(asked).toHaveLength(1);
    expect(container.innerHTML).not.toContain(TOKEN);
  });

  it('holds its place, named, while it loads', () => {
    render(
      <PrivateImage
        id="m1"
        load={() => new Promise<Blob>(() => undefined)}
        alt="Your photo"
        renderFailed={failed}
      />,
    );
    expect(screen.getByRole('img', { name: 'Your photo' })).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps a picture with no words from being announced while it loads', () => {
    render(
      <PrivateImage
        id="m1"
        load={() => new Promise(() => undefined)}
        alt=""
        renderFailed={failed}
      />,
    );
    const frame = document.querySelector('[aria-hidden="true"]');
    expect(frame).not.toBeNull();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(frame).not.toHaveAttribute('aria-busy');
  });

  it('releases the object URL when it leaves the page', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test/gone');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const { unmount } = render(
      <PrivateImage id="m1" load={() => Promise.resolve(picture)} alt="" renderFailed={failed} />,
    );
    await waitFor(() =>
      expect(document.querySelector('img')).toHaveAttribute('src', 'blob:test/gone'),
    );
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:test/gone');
  });

  it('offers to try again when it cannot be read, and reads it again', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test/second');
    const load = vi
      .fn<() => Promise<Blob>>()
      .mockRejectedValueOnce(new ApiError({ status: 404, messages: [] }))
      .mockResolvedValueOnce(picture);
    render(<PrivateImage id="m1" load={load} alt="Shared photo" renderFailed={failed} />);
    (await screen.findByRole('button', { name: 'Try again' })).click();
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Shared photo' })).toHaveAttribute(
        'src',
        'blob:test/second',
      ),
    );
    expect(load).toHaveBeenCalledTimes(2);
  });
});
