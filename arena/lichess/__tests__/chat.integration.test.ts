// End-to-end check of the live chat path against the REAL engine binary:
// RustEngine.facts() -> curateChatLine() -> client.chat(). Skipped when the engine
// binary is absent so the suite still runs on a machine without a Rust build.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RustEngine } from '../../gauntlet/rust-engine';
import { curateChatLine } from '../../../engine/teaching/chatLine';
import { makeChatter } from '../chat';

const EXE =
  process.env.CVS_RUST_EXE ?? '../chess-vision-studio-rust-engine/target/release/analyze.exe';
const hasEngine = existsSync(EXE);

// Nc7+ forks the king on e8 and the rook on a8 — a deterministic, validator-proven fork.
const ROYAL_FORK_FEN = 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1';
const ROYAL_FORK_UCI = 'b5c7';

describe.skipIf(!hasEngine)('chat line end-to-end (real engine)', () => {
  it('curates a validator-backed line from a real fact bundle', async () => {
    const engine = new RustEngine(EXE, 1);
    try {
      const bundle = await engine.facts({
        schemaVersion: 1,
        fenBefore: ROYAL_FORK_FEN,
        playedMoveUci: ROYAL_FORK_UCI,
        options: { includeMotifOpportunities: true, includeCounterfactual: true },
      });
      expect(bundle.errors).toEqual([]);
      expect(bundle.provenance.factsRegistryVersion).toBeGreaterThanOrEqual(7);

      const line = curateChatLine(bundle, { subject: 'ours', moveLabel: 'Nc7+' });
      expect(line).not.toBeNull();
      expect(line?.text).toContain('forks');
      expect(line?.validators).toEqual(['fork_validation']);
      expect(line?.tier).toBe(2);
      expect(line?.text.length).toBeLessThanOrEqual(148);
    } finally {
      engine.dispose();
    }
  }, 60_000);

  it('speaks once and then stays silent on the same claim', async () => {
    const said: string[] = [];
    const chatter = makeChatter(
      { chat: async (_gameId, text) => (said.push(text), true) },
      { exe: EXE, log: () => {} },
    );
    try {
      await chatter.afterOurMove('g1', ROYAL_FORK_FEN, ROYAL_FORK_UCI);
      await chatter.afterOurMove('g1', ROYAL_FORK_FEN, ROYAL_FORK_UCI); // same claim
      expect(said).toHaveLength(1);
      expect(said[0]).toContain('forks');
    } finally {
      chatter.dispose();
    }
  }, 60_000);

  it('never throws when the engine cannot answer', async () => {
    const chatter = makeChatter(
      { chat: async () => true },
      { exe: EXE, log: () => {} },
    );
    try {
      await expect(
        chatter.afterOurMove('g2', 'not-a-fen', 'e2e4'),
      ).resolves.toBeUndefined();
    } finally {
      chatter.dispose();
    }
  }, 60_000);
});
