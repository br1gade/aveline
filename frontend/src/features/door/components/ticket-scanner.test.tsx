import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createI18n } from '@/lib/i18n';

import { TicketScanner } from './ticket-scanner';
import type { Door } from './use-door';

const decoder = vi.hoisted(() => ({
  read: (_data: Uint8ClampedArray, _width: number, _height: number): unknown => null,
}));
vi.mock('jsqr', () => ({
  default: (data: Uint8ClampedArray, width: number, height: number) =>
    decoder.read(data, width, height),
}));

const CODE = 'ABCDEFGH12345678';
const track = { stop: vi.fn(), addEventListener: vi.fn() };
const onAnswer = vi.fn();
const dismiss = vi.fn();
const codeEdited = vi.fn();
const drawImage = vi.fn();
const someFrame = (_x: number, _y: number, width: number, height: number) => ({
  data: new Uint8ClampedArray(width * height * 4),
});
const getImageData = vi.fn(someFrame);
const scrollIntoView = vi.fn();
const lockRelease = vi.fn(() => Promise.resolve());
const lockRequest = vi.fn<(type: string) => Promise<unknown>>();
const stream = { getTracks: () => [track] };
const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<unknown>>();
const admit = vi.fn(() => Promise.resolve(true));

function doorWith(running: string | null = null) {
  return { state: { running }, actions: { admit, dismiss, codeEdited } } as unknown as Door;
}

function renderScanner(door = doorWith()) {
  const i18n = createI18n('en');
  const tree = (current: Door) => (
    <I18nextProvider i18n={i18n}>
      <TicketScanner door={current} onAnswer={onAnswer} />
    </I18nextProvider>
  );
  const view = render(tree(door));
  return {
    user: userEvent.setup(),
    unmount: view.unmount,
    rerender: (next: Door) => view.rerender(tree(next)),
  };
}

const openButton = () => screen.getByRole('button', { name: 'Scan a ticket' });
const closeButton = () => screen.getByRole('button', { name: 'Stop the camera' });
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  track.stop.mockClear();
  track.addEventListener.mockClear();
  admit.mockClear();
  onAnswer.mockClear();
  dismiss.mockClear();
  codeEdited.mockClear();
  drawImage.mockClear();
  getImageData.mockReset();
  getImageData.mockImplementation(someFrame);
  scrollIntoView.mockClear();
  lockRelease.mockClear();
  lockRequest.mockReset();
  lockRequest.mockResolvedValue({ release: lockRelease });
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request: lockRequest },
  });
  Element.prototype.scrollIntoView = scrollIntoView;
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue(stream);
  decoder.read = () => null;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1280);
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(720);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
    getImageData,
  } as unknown as RenderingContext);
});
afterEach(() => {
  vi.restoreAllMocks();
  setVisibility('visible');
});

describe('before it is asked for', () => {
  it('doesn’t ask for the camera', () => {
    renderScanner();
    expect(openButton()).toBeVisible();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('keeps the reader out of the door page until it is opened', () => {
    const door = join(import.meta.dirname, '..');
    const files = readdirSync(door, { recursive: true, encoding: 'utf8' }).filter(
      (file) => /\.tsx?$/.test(file) && !file.includes('.test.'),
    );
    expect(files).toContain(join('components', 'use-camera.ts'));
    for (const file of files) {
      expect(readFileSync(join(door, file), 'utf8')).not.toMatch(/from 'jsqr'/);
    }
  });
});

describe('opening the camera', () => {
  it('asks for the rear one, with no sound', async () => {
    const { user } = renderScanner();
    await user.click(openButton());
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(getUserMedia.mock.calls[0]?.[0]).toEqual({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
    expect(await screen.findByLabelText('What the camera sees')).toHaveProperty('muted', true);
  });

  it('brings the viewfinder into view once it has a picture, for one hand at the door', async () => {
    const { user } = renderScanner();
    await user.click(openButton());
    await screen.findByText(/Hold the ticket’s code/);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    // The whole scanner, so its Stop stays on the screen with the picture.
    expect(scrollIntoView.mock.contexts[0]).toContainElement(closeButton());
  });

  it('reads only what the viewfinder shows, at a smaller size', async () => {
    const sizes: number[][] = [];
    decoder.read = (_data, width, height) => {
      sizes.push([width, height]);
      return null;
    };
    const { user } = renderScanner();
    await user.click(openButton());
    await waitFor(() => expect(sizes.length).toBeGreaterThan(0));
    expect(sizes[0]).toEqual([640, 640]);
    const [, x, y, side, side2, , , size, size2] = drawImage.mock.calls[0] as number[];
    expect([x, y, side, side2]).toEqual([280, 0, 720, 720]);
    expect([size, size2]).toEqual([640, 640]);
  });

  it('keeps the screen awake while it watches, and lets it sleep afterwards', async () => {
    const { user } = renderScanner();
    await user.click(openButton());
    await screen.findByText(/Hold the ticket’s code/);
    expect(lockRequest).toHaveBeenCalledWith('screen');
    await user.click(closeButton());
    await waitFor(() => expect(lockRelease).toHaveBeenCalledTimes(1));
  });

  it('works where the screen can’t be kept awake', async () => {
    lockRequest.mockRejectedValue(new DOMException('x', 'NotAllowedError'));
    const { user } = renderScanner();
    await user.click(openButton());
    expect(await screen.findByText(/Hold the ticket’s code/)).toBeVisible();
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    await user.click(closeButton());
    await user.click(openButton());
    expect(await screen.findByText(/Hold the ticket’s code/)).toBeVisible();
  });

  it('doesn’t read until the camera has a picture', async () => {
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(0);
    const read = vi.fn(() => null);
    decoder.read = read;
    const { user } = renderScanner();
    await user.click(openButton());
    await screen.findByText(/Hold the ticket’s code/);
    await waitFor(() => expect(track.addEventListener).toHaveBeenCalled());
    expect(read).not.toHaveBeenCalled();
  });
});

describe('what it reads', () => {
  it('admits a ticket once, however many frames see it', async () => {
    let seen = 0;
    decoder.read = () => {
      seen += 1;
      return { data: CODE };
    };
    const { user } = renderScanner();
    await user.click(openButton());
    await waitFor(() => expect(seen).toBeGreaterThanOrEqual(3));
    expect(admit).toHaveBeenCalledTimes(1);
    expect(admit).toHaveBeenCalledWith(CODE);
    expect(onAnswer).toHaveBeenCalledWith(CODE, true);
  });

  it('takes the last guest’s answer away before sending the next', async () => {
    decoder.read = () => ({ data: CODE });
    const { user } = renderScanner();
    await user.click(openButton());
    await waitFor(() => expect(admit).toHaveBeenCalled());
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(dismiss.mock.invocationCallOrder[0]).toBeLessThan(admit.mock.invocationCallOrder[0]!);
  });

  it('forgets the lost code when another ticket is read, not when the same one is', async () => {
    let read = CODE;
    decoder.read = () => ({ data: read });
    const { user } = renderScanner();
    await user.click(openButton());
    await waitFor(() => expect(admit).toHaveBeenCalledTimes(1));
    const first = codeEdited.mock.calls.length;
    read = 'ZZZZZZZZ12345678';
    await waitFor(() => expect(admit).toHaveBeenCalledTimes(2));
    expect(codeEdited.mock.calls.length).toBe(first + 1);
  });

  it('keeps a lost code’s history when the same ticket comes round again', async () => {
    const start = Date.now();
    let now = start;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    decoder.read = () => ({ data: CODE });
    const { user } = renderScanner();
    await user.click(openButton());
    await waitFor(() => expect(admit).toHaveBeenCalledTimes(1));
    const first = codeEdited.mock.calls.length;
    now = start + 60_000;
    await waitFor(() => expect(admit).toHaveBeenCalledTimes(2));
    expect(codeEdited.mock.calls.length).toBe(first);
  });

  it('says it is sending while the door has no answer yet', async () => {
    const { user } = renderScanner(doorWith('code'));
    await user.click(openButton());
    expect(await screen.findByText('Sending…')).toBeVisible();
  });

  it('doesn’t say so for another write at the door', async () => {
    const { user } = renderScanner(doorWith('g1'));
    await user.click(openButton());
    await screen.findByText(/Hold the ticket’s code/);
    expect(screen.queryByText('Sending…')).toBeNull();
  });

  it('goes on past a frame the reader chokes on', async () => {
    let frames = 0;
    decoder.read = () => {
      frames += 1;
      if (frames === 1) throw new RangeError('Reed-Solomon');
      return { data: CODE };
    };
    const { user } = renderScanner();
    await user.click(openButton());
    await waitFor(() => expect(admit).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sends nothing for what isn’t a ticket, a guest’s own link above all, and says so', async () => {
    decoder.read = () => ({ data: 'https://aveline.am/invitations/anna/g/abcdefghijkl' });
    const { user } = renderScanner();
    await user.click(openButton());
    expect(await screen.findByText(/isn’t a ticket/)).toBeVisible();
    expect(admit).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain('abcdefghijkl');
  });

  it('stops saying so once a ticket is read', async () => {
    let read = 'not a ticket';
    decoder.read = () => ({ data: read });
    const { user } = renderScanner();
    await user.click(openButton());
    await screen.findByText(/isn’t a ticket/);
    read = CODE;
    await waitFor(() => expect(screen.queryByText(/isn’t a ticket/)).toBeNull());
  });

  it('leaves a code for when the door is free', async () => {
    const { user, rerender } = renderScanner(doorWith('another write'));
    let seen = 0;
    decoder.read = () => {
      seen += 1;
      return { data: CODE };
    };
    await user.click(openButton());
    await waitFor(() => expect(seen).toBeGreaterThanOrEqual(2));
    expect(admit).not.toHaveBeenCalled();
    rerender(doorWith());
    await waitFor(() => expect(admit).toHaveBeenCalledTimes(1));
  });
});

describe('putting the camera away', () => {
  async function opened() {
    const rendered = renderScanner();
    await rendered.user.click(openButton());
    await screen.findByText(/Hold the ticket’s code/);
    return rendered;
  }

  it('stops it when asked, and offers it again', async () => {
    const { user } = await opened();
    await user.click(closeButton());
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(openButton()).toBeVisible();
    expect(screen.queryByLabelText('What the camera sees')).toBeNull();
  });

  it('stops reading once stopped', async () => {
    const read = vi.fn(() => null);
    decoder.read = read;
    await opened();
    vi.useFakeTimers();
    try {
      fireEvent.click(closeButton());
      const before = read.mock.calls.length;
      vi.advanceTimersByTime(2000);
      expect(read.mock.calls.length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so, and stops the camera, when a frame can’t be taken', async () => {
    const { user } = renderScanner();
    getImageData.mockImplementation(() => {
      throw new DOMException('x', 'InvalidStateError');
    });
    await user.click(openButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t open or stopped/);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('takes “not a ticket” away with the camera', async () => {
    decoder.read = () => ({ data: 'not a ticket' });
    const { user } = renderScanner();
    await user.click(openButton());
    await screen.findByText(/isn’t a ticket/);
    act(() => setVisibility('hidden'));
    expect(screen.queryByText(/isn’t a ticket/)).toBeNull();
  });

  it('stops it on leaving the page', async () => {
    const { unmount } = await opened();
    unmount();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('stops it when the tab is hidden', async () => {
    await opened();
    act(() => setVisibility('hidden'));
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(openButton()).toBeVisible();
  });

  it('leaves it alone when the tab comes back into view', async () => {
    await opened();
    act(() => setVisibility('visible'));
    expect(track.stop).not.toHaveBeenCalled();
  });

  it('stops a camera that answers only after it was put away', async () => {
    let answer: (value: unknown) => void = () => undefined;
    getUserMedia.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { user } = renderScanner();
    await user.click(openButton());
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    await user.click(closeButton());
    await act(() => {
      answer(stream);
      return Promise.resolve();
    });
    await waitFor(() => expect(track.stop).toHaveBeenCalledTimes(1));
    expect(openButton()).toBeVisible();
  });

  it('stops a camera whose picture starts only after it was put away', async () => {
    let start: () => void = () => undefined;
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockReturnValue(
      new Promise<void>((resolve) => (start = resolve)),
    );
    const { user } = renderScanner();
    await user.click(openButton());
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    await user.click(closeButton());
    await act(() => {
      start();
      return Promise.resolve();
    });
    await waitFor(() => expect(track.stop).toHaveBeenCalled());
    expect(openButton()).toBeVisible();
  });

  it.each(['ended', 'mute'])('says so when the track is %s by something else', async (event) => {
    await opened();
    const listener = track.addEventListener.mock.calls.find(([name]) => name === event);
    act(() => (listener?.[1] as () => void)());
    expect(await screen.findByRole('alert')).toHaveTextContent(/type the code/);
    expect(openButton()).toBeVisible();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });
});

describe('a camera that won’t open', () => {
  it.each([
    ['NotAllowedError', /isn’t allowed/],
    ['NotFoundError', /no camera/],
    ['NotReadableError', /couldn’t open/],
  ])('%s is worded, pointing to the typed field', async (name, words) => {
    getUserMedia.mockRejectedValue(new DOMException('x', name));
    const { user } = renderScanner();
    await user.click(openButton());
    const said = await screen.findByRole('alert');
    expect(said).toHaveTextContent(words);
    expect(said).toHaveTextContent(/type the code/);
    expect(openButton()).toBeVisible();
    expect(screen.queryByLabelText('What the camera sees')).toBeNull();
  });

  it('is worded on a page with no way to ask, as one not on https', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    const { user } = renderScanner();
    await user.click(openButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/secure page/);
  });

  it('doesn’t blame permission for a picture that won’t play, or leave “opening” on a surprise', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(
      new DOMException('x', 'NotAllowedError'),
    );
    const { user } = renderScanner();
    await user.click(openButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t open or stopped/);
  });

  it('stops the camera if its picture can’t play', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(
      new DOMException('x', 'AbortError'),
    );
    const { user } = renderScanner();
    await user.click(openButton());
    await screen.findByRole('alert');
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('takes the words away on trying again', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('x', 'NotAllowedError'));
    const { user } = renderScanner();
    await user.click(openButton());
    await screen.findByRole('alert');
    await user.click(openButton());
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await screen.findByText(/Hold the ticket’s code/);
  });
});
