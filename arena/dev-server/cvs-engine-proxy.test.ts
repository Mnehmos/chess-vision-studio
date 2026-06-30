import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCvsLineDispatcher,
  cvsEngineFeatureFlags,
  cvsEnginePoolSize,
  cvsEngineRuntime,
} from './cvs-engine-proxy';

afterEach(() => {
  vi.useRealTimers();
});

describe('CVS engine line dispatcher', () => {
  it('forwards the explicit unverified-network development override', () => {
    expect(
      cvsEngineFeatureFlags({
        CVS_RUST_ALLOW_UNVERIFIED: '1',
        CVS_RUST_FUTILITY: '0',
      }),
    ).toContain('--allow-unverified-net');
  });

  it('maps specialist SMP settings to bounded Rust CLI flags', () => {
    expect(
      cvsEngineRuntime({
        CVS_RUST_CVS_HELPERS: '2',
      }),
    ).toEqual({ threads: 3, cvsHelpers: 2 });
    expect(
      cvsEngineFeatureFlags({
        CVS_RUST_FUTILITY: '0',
        CVS_RUST_THREADS: '4',
        CVS_RUST_CVS_HELPERS: '9',
      }),
    ).toEqual(['--threads', '4', '--cvs-helpers', '3']);
  });

  it('scales process pool size down when each Rust process owns more threads', () => {
    expect(cvsEnginePoolSize(16, 1)).toBe(8);
    expect(cvsEnginePoolSize(16, 4)).toBe(3);
    expect(cvsEnginePoolSize(4, 8)).toBe(1);
  });

  it('preserves response ordering when timed-out stdout arrives late', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const dispatcher = createCvsLineDispatcher((line) => writes.push(line), 25);

    const first = dispatcher.request('first');
    const firstRejected = expect(first).rejects.toThrow('CVS Engine request timed out');
    await vi.advanceTimersByTimeAsync(25);
    await firstRejected;

    const second = dispatcher.request('second');
    let secondResult: string | undefined;
    void second.then((line) => {
      secondResult = line;
    });

    dispatcher.handleLine('late first response');
    await Promise.resolve();
    expect(secondResult).toBeUndefined();
    expect(dispatcher.pendingCount()).toBe(1);

    dispatcher.handleLine('second response');
    await expect(second).resolves.toBe('second response');
    expect(writes).toEqual(['first', 'second']);
    expect(dispatcher.pendingCount()).toBe(0);
  });

  it('rejects every outstanding request when the process fails', async () => {
    const dispatcher = createCvsLineDispatcher(() => {}, 1_000);
    const first = dispatcher.request('first');
    const second = dispatcher.request('second');

    dispatcher.fail(new Error('engine stopped'));

    await expect(first).rejects.toThrow('engine stopped');
    await expect(second).rejects.toThrow('engine stopped');
    expect(dispatcher.pendingCount()).toBe(0);
  });

  it('rejects immediately when stdin writing fails', async () => {
    const dispatcher = createCvsLineDispatcher(() => {
      throw new Error('broken pipe');
    });

    await expect(dispatcher.request('request')).rejects.toThrow('broken pipe');
    expect(dispatcher.pendingCount()).toBe(0);
  });
});
