import { describe, expect, it } from 'vitest';
import { parseNdjson } from '../ndjson';
import { shouldAccept } from '../policy';
import { LichessClient, type GameStreamEvent, type LichessEvent } from '../client';
import { playSession, type MovePicker } from '../session';
import { runBot } from '../run';
import type { LichessConfig } from '../env';
import type { ChallengeEvent } from '../client';

const enc = new TextEncoder();

function bytes(...chunks: string[]): AsyncIterable<Uint8Array> {
  return (async function* () {
    for (const c of chunks) yield enc.encode(c);
  })();
}

const CFG: LichessConfig = {
  token: '',
  username: '',
  depth: 3,
  acceptCasual: true,
  acceptRated: true,
  botsOnly: false,
  minClockInitialSec: 180,
  allowCorrespondence: true,
  seedAi: false,
  seedAiLevels: [],
  seedAiClockLimitSec: 300,
  seedAiClockIncrementSec: 3,
  maxConcurrentGames: 1,
  review: false,
  reviewDepth: 10,
  weightsPath: 'arena/out/weights.json',
  outDir: 'arena/out',
};

function scriptedPicker(name: string, ucis: string[]): MovePicker {
  let i = 0;
  return { name, async pick() { return ucis[i++] ?? null; } };
}

describe('parseNdjson', () => {
  it('buffers partial chunks and skips blank keep-alive lines', async () => {
    const out: unknown[] = [];
    for await (const v of parseNdjson(bytes('{"a":1}\n{"b":', '2}\n\n{"c":3}\n'))) out.push(v);
    expect(out).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('emits a final unterminated line', async () => {
    const out: unknown[] = [];
    for await (const v of parseNdjson(bytes('{"x":1}'))) out.push(v);
    expect(out).toEqual([{ x: 1 }]);
  });
});

describe('shouldAccept policy', () => {
  const ch = (o: Partial<ChallengeEvent>): ChallengeEvent => ({ id: 'c1', ...o });

  it('declines non-standard variants', () => {
    expect(shouldAccept(ch({ variant: { key: 'chess960' } }), CFG)).toMatchObject({ accept: false, reason: 'variant' });
  });

  it('declines too-fast real-time games', () => {
    const fast = ch({ speed: 'bullet', timeControl: { type: 'clock', limit: 60, increment: 0 } });
    expect(shouldAccept(fast, CFG)).toMatchObject({ accept: false, reason: 'tooFast' });
  });

  it('accepts a casual rapid game', () => {
    const rapid = ch({ rated: false, speed: 'rapid', timeControl: { type: 'clock', limit: 600, increment: 0 } });
    expect(shouldAccept(rapid, CFG)).toEqual({ accept: true });
  });

  it('accepts a rated game, but declines it when acceptRated is off', () => {
    const rated = ch({ rated: true, speed: 'rapid', timeControl: { type: 'clock', limit: 600, increment: 0 } });
    expect(shouldAccept(rated, CFG)).toEqual({ accept: true });
    expect(shouldAccept(rated, { ...CFG, acceptRated: false })).toMatchObject({ accept: false, reason: 'rated' });
  });

  it('honors correspondence and bot-only postures', () => {
    const corr = ch({ speed: 'correspondence', timeControl: { type: 'correspondence', daysPerTurn: 1 } });
    expect(shouldAccept(corr, CFG)).toEqual({ accept: true });
    expect(shouldAccept(corr, { ...CFG, allowCorrespondence: false })).toMatchObject({ accept: false, reason: 'tooSlow' });

    const human = ch({ rated: false, speed: 'rapid', timeControl: { type: 'clock', limit: 600 }, challenger: { id: 'joe' } });
    expect(shouldAccept(human, { ...CFG, botsOnly: true })).toMatchObject({ accept: false, reason: 'onlyBot' });
    const bot = ch({ rated: false, speed: 'rapid', timeControl: { type: 'clock', limit: 600 }, challenger: { id: 'b', title: 'BOT' } });
    expect(shouldAccept(bot, { ...CFG, botsOnly: true })).toEqual({ accept: true });
  });
});

describe('LichessClient (mock transport)', () => {
  it('move() POSTs to the Bot move endpoint with the UCI in the path', async () => {
    let captured: { url: string; method?: string } | undefined;
    const fetchLike = async (url: string, init?: RequestInit) => {
      captured = { url, method: init?.method };
      return { ok: true, status: 200, body: null, async json() { return {}; }, async text() { return ''; } };
    };
    const c = new LichessClient({ token: 'tok', fetchLike });
    expect(await c.move('abc', 'e7e8q')).toBe(true);
    expect(captured!.url).toBe('https://lichess.org/api/bot/game/abc/move/e7e8q');
    expect(captured!.method).toBe('POST');
  });

  it('streamEvents() parses the ndjson event feed', async () => {
    const feed = '{"type":"challenge","challenge":{"id":"c1"}}\n\n{"type":"gameStart","game":{"gameId":"g1"}}\n';
    const fetchLike = async () => ({ ok: true, status: 200, body: bytes(feed), async json() { return {}; }, async text() { return ''; } });
    const c = new LichessClient({ token: 't', fetchLike });
    const types: string[] = [];
    for await (const ev of c.streamEvents()) types.push((ev as { type: string }).type);
    expect(types).toEqual(['challenge', 'gameStart']);
  });
});

describe('playSession', () => {
  it('plays our moves on our turn and reconstructs a GameRecord', async () => {
    const events: GameStreamEvent[] = [
      {
        type: 'gameFull',
        id: 'g1',
        initialFen: 'startpos',
        white: { id: 'cvsbot', name: 'cvsbot' },
        black: { id: 'human', name: 'human' },
        state: { type: 'gameState', moves: '', wtime: 60000, btime: 60000, status: 'started' },
      },
      { type: 'gameState', moves: 'e2e4 e7e5', wtime: 60000, btime: 60000, status: 'started' },
      { type: 'gameState', moves: 'e2e4 e7e5 g1f3', wtime: 60000, btime: 60000, status: 'resign', winner: 'white' },
    ];
    const calls: { move: [string, string][]; resign: string[] } = { move: [], resign: [] };
    const fakeClient = {
      async *streamGame() {
        for (const e of events) yield e;
      },
      async move(id: string, uci: string) {
        calls.move.push([id, uci]);
        return true;
      },
      async resign(id: string) {
        calls.resign.push(id);
        return true;
      },
    } as unknown as LichessClient;

    const res = await playSession(fakeClient, 'g1', 'cvsbot', scriptedPicker('cvs@3', ['e2e4', 'g1f3']), {});

    expect(calls.move).toEqual([['g1', 'e2e4'], ['g1', 'g1f3']]);
    expect(res.cvsColor).toBe('white');
    expect(res.record.result).toBe('1-0');
    expect(res.record.plies.map((p) => p.uci)).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(res.record.plies[0]!.player).toBe('cvs@3');
    expect(res.record.plies[1]!.player).toBe('opponent');
    expect(res.record.plies[0]!.san).toBe('e4');
  });

  it('does not POST an illegal picker move; it resigns instead of hanging', async () => {
    const events: GameStreamEvent[] = [
      {
        type: 'gameFull',
        id: 'g1',
        initialFen: 'startpos',
        white: { id: 'cvsbot', name: 'cvsbot' },
        black: { id: 'human', name: 'human' },
        state: { type: 'gameState', moves: '', wtime: 60000, btime: 60000, status: 'started' },
      },
    ];
    const calls: { move: [string, string][]; resign: string[] } = { move: [], resign: [] };
    const fakeClient = {
      async *streamGame() {
        for (const e of events) yield e;
      },
      async move(id: string, uci: string) {
        calls.move.push([id, uci]);
        return true;
      },
      async resign(id: string) {
        calls.resign.push(id);
        return true;
      },
    } as unknown as LichessClient;

    await playSession(fakeClient, 'g1', 'cvsbot', scriptedPicker('bad', ['e2e5']), {});

    expect(calls.move).toEqual([]);
    expect(calls.resign).toEqual(['g1']);
  });

  it('retries a rejected move POST and exits WITHOUT resigning (rate-limit storms are not losses)', async () => {
    const events: GameStreamEvent[] = [
      {
        type: 'gameFull',
        id: 'g1',
        initialFen: 'startpos',
        white: { id: 'cvsbot', name: 'cvsbot' },
        black: { id: 'human', name: 'human' },
        state: { type: 'gameState', moves: '', wtime: 60000, btime: 60000, status: 'started' },
      },
    ];
    const calls: { move: [string, string][]; resign: string[] } = { move: [], resign: [] };
    const fakeClient = {
      async *streamGame() {
        for (const e of events) yield e;
      },
      async move(id: string, uci: string) {
        calls.move.push([id, uci]);
        return false;
      },
      async resign(id: string) {
        calls.resign.push(id);
        return true;
      },
    } as unknown as LichessClient;

    await playSession(fakeClient, 'g1', 'cvsbot', scriptedPicker('rejected', ['e2e4']), {});

    expect(calls.move.length).toBeGreaterThan(1); // retried, not one-shot
    for (const [id, uci] of calls.move) expect([id, uci]).toEqual(['g1', 'e2e4']);
    expect(calls.resign).toEqual([]); // a failed POST must never be a resignation
  }, 45_000);
});

describe('runBot protocol resilience', () => {
  it('reconnects the event stream after a drop', async () => {
    let streams = 0;
    const accepted: string[] = [];
    const logs: string[] = [];
    const challenge: LichessEvent = {
      type: 'challenge',
      challenge: {
        id: 'c2',
        rated: false,
        variant: { key: 'standard' },
        speed: 'rapid',
        timeControl: { type: 'clock', limit: 600, increment: 0 },
        challenger: { id: 'human' },
      },
    };
    const fakeClient = {
      async account() {
        return { id: 'cvsbot', username: 'cvsbot', title: 'BOT' };
      },
      async *streamEvents<T>() {
        streams += 1;
        if (streams === 1) throw new Error('dropped stream');
        yield challenge as T;
      },
      async acceptChallenge(id: string) {
        accepted.push(id);
        return true;
      },
      async declineChallenge() {
        return true;
      },
    } as unknown as LichessClient;

    await runBot(CFG, (m) => logs.push(m), {
      client: fakeClient,
      picker: scriptedPicker('unused', []),
      maxEventStreamRestarts: 1,
      reconnectDelayMs: 0,
    });

    expect(streams).toBe(2);
    expect(accepted).toEqual(['c2']);
    expect(logs.some((l) => l.includes('event stream error'))).toBe(true);
  });
});
