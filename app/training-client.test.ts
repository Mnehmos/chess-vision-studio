// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STOCKFISH_REVIEW_DEPTH } from '../arena/review-config';
import {
  DEFAULT_TRAINING_CONFIG,
  IDLE_TRAINING_STATUS,
  fetchTrainingStatus,
  openTrainingEvents,
  startTraining,
  stopTraining,
} from './training-client';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('training client', () => {
  it('uses the shared Stockfish review depth default', () => {
    expect(DEFAULT_TRAINING_CONFIG.depth).toBe(DEFAULT_STOCKFISH_REVIEW_DEPTH);
  });

  it('loads status and preserves non-OK status as unavailable', async () => {
    const status = { ...IDLE_TRAINING_STATUS, phase: 'done' as const };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(status), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(fetchTrainingStatus()).resolves.toEqual(status);
    expect(fetchMock).toHaveBeenCalledWith('/api/training/status');

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await expect(fetchTrainingStatus()).resolves.toBeNull();
  });

  it('posts start and stop requests with readable server errors', async () => {
    const status = { ...IDLE_TRAINING_STATUS, active: true };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(status), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'training job already running' }), { status: 409 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(IDLE_TRAINING_STATUS), { status: 200 }));

    await expect(startTraining(DEFAULT_TRAINING_CONFIG)).resolves.toEqual(status);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/training/start',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(DEFAULT_TRAINING_CONFIG),
      }),
    );
    await expect(startTraining(DEFAULT_TRAINING_CONFIG)).rejects.toThrow(
      /training job already running/,
    );
    await expect(stopTraining()).resolves.toEqual(IDLE_TRAINING_STATUS);
    expect(fetchMock).toHaveBeenCalledWith('/api/training/stop', { method: 'POST' });
  });

  it('opens the training SSE stream and parses status events', () => {
    class FakeEventSource {
      static last: FakeEventSource | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      closed = false;

      constructor(public url: string) {
        FakeEventSource.last = this;
      }

      close() {
        this.closed = true;
      }
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const onStatus = vi.fn();
    const onError = vi.fn();

    const events = openTrainingEvents(onStatus, onError);
    expect(FakeEventSource.last?.url).toBe('/api/training/events');

    FakeEventSource.last?.onmessage?.({
      data: JSON.stringify({ ...IDLE_TRAINING_STATUS, phase: 'training' }),
    } as MessageEvent);
    FakeEventSource.last?.onerror?.();
    events.close();

    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ phase: 'training' }));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.last?.closed).toBe(true);
  });
});
