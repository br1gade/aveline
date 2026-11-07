import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDialogAction } from './use-dialog-action';

function setup() {
  const page = { done: vi.fn(() => Promise.resolve()), reload: vi.fn(), focusStatus: vi.fn() };
  const onClose = vi.fn();
  const refusalOf = (error: unknown) => {
    if (!(error instanceof RangeError)) throw error;
    return { kind: 'refused', isStale: error.message === 'stale' };
  };
  const hook = renderHook(() =>
    useDialogAction({ page, onClose, restoreFocus: vi.fn() }, refusalOf),
  );
  return { hook, page, onClose };
}

describe('useDialogAction', () => {
  it('says what happened and closes after an action went through', async () => {
    const { hook, page, onClose } = setup();
    await act(() => hook.result.current.run(() => Promise.resolve(), 'Done.'));
    expect(page.done).toHaveBeenCalledWith('Done.');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('can’t be closed while busy, and keeps a refusal open, reloading a stale one', async () => {
    const { hook, page, onClose } = setup();
    let fail = (_error: Error) => undefined as void;
    const action = new Promise<void>((_resolve, reject) => {
      fail = reject;
    });
    let running: Promise<void> = Promise.resolve();
    act(() => {
      running = hook.result.current.run(() => action, 'Done.');
    });
    expect(hook.result.current.isBusy).toBe(true);
    act(() => hook.result.current.onOpenChange(false));
    expect(onClose).not.toHaveBeenCalled();
    fail(new RangeError('stale'));
    await act(() => running);
    expect(hook.result.current.isBusy).toBe(false);
    expect(hook.result.current.refusal).toEqual({ kind: 'refused', isStale: true });
    expect(page.reload).toHaveBeenCalledOnce();
  });

  it('is free again after an error that isn’t the API’s, which it throws on', async () => {
    const { hook } = setup();
    await act(async () => {
      await expect(
        hook.result.current.run(() => Promise.reject(new Error('bug')), 'Done.'),
      ).rejects.toThrow('bug');
    });
    expect(hook.result.current.isBusy).toBe(false);
  });
});
