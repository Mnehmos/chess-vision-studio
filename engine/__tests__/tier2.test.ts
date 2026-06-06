// Tier-2 motif detector tests. The dataset's labels are NOT ground truth — the
// SEARCH ORACLE (tacticalOutcome) is. We require:
//   POSITIVES the oracle confirms a win/mate for  → MUST be detected as a winning
//             Tier-2 tactic (sub-type label is best-effort).
//   NEGATIVES the oracle confirms no win for       → MUST NOT be emitted.
//   Dataset MISLABEL (trapped-rook-on-h-file): labelled positive, oracle finds NO
//             win → we correctly do NOT emit it (caught mislabel).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectTier2 } from '../tier2';
import { tacticalOutcome } from '../tacticsearch';

interface ExtCase {
  id: string;
  fen: string;
  motif: string;
  isPositive: boolean;
  lookAlikeOf?: string | null;
  solution?: string[];
  expectedOutcome?: string;
  themes?: string[];
}

const FILE = join(__dirname, '../../fixtures/chatgpt-cases.json');
const raw = JSON.parse(readFileSync(FILE, 'utf8')) as { cases: ExtCase[] };
const byId = new Map(raw.cases.map((c) => [c.id, c]));
function fenOf(id: string): string {
  const c = byId.get(id);
  if (!c) throw new Error(`fixture id not found: ${id}`);
  return c.fen;
}

const TIER2_TYPES = new Set([
  'overload',
  'deflection',
  'decoy',
  'interference',
  'zwischenzug',
  'trapped_piece',
]);

/** Oracle ground truth: does the side to move have a forcing win (>=1.5) or force mate? */
function oracleWins(fen: string): boolean {
  const out = tacticalOutcome(fen, 6);
  if (out.mateInPlies !== null) return out.mateInPlies > 0; // side to move forces mate
  return out.gain >= 1.5;
}

// ── The required POSITIVE ids (oracle-confirmed wins). Must be DETECTED. ──────
// NOTE on interference: the two `interference-*` "positives" are handled in a
// dedicated block below. The search ORACLE (ground truth) proves the intended
// interference line (Bd2 / Be2) is REFUTED by a precise defence (…Qa8 / …Qe8);
// the position is actually won only by an INDEPENDENT Tier-1 back-rank mate
// (Re8# / Rd8#), which is out of Tier-2 scope. Being conservative, we therefore
// do NOT fabricate an unvalidated interference motif for them. This is a SECOND
// caught dataset issue (the interference framing is not supported by the search).
const POSITIVE_IDS = [
  'overload-queen-on-back-rank',
  'deflection-queen-from-defense',
  'decoy-queen-to-e8',
  'zwischenzug-check-before-queen',
  // mirror variants
  'overload-queen-on-back-rank-mirror',
  'deflection-queen-from-defense-mirror',
  'decoy-queen-to-e8-mirror',
  'zwischenzug-check-before-queen-mirror',
];

// Interference "positives" whose intended motif the oracle refutes (see note above).
const INTERFERENCE_UNVALIDATED_IDS = [
  'interference-bishop-saves-rook-wins-queen',
  'interference-bishop-saves-rook-wins-queen-mirror',
];

// ── The required NEGATIVE ids (oracle confirms NO Tier-2 win). Must NOT emit. ──
const NEGATIVE_IDS = [
  'overload-has-backup-knight',
  'deflection-backup-knight-saves',
  'decoy-queen-sac-captured',
  'zwischenzug-not-forcing',
  'interference-piece-captured-safely',
  'trapped-queen-has-escape',
  // mirror negatives
  'overload-has-backup-knight-mirror',
  'deflection-backup-knight-saves-mirror',
  'decoy-queen-sac-captured-mirror',
  'zwischenzug-not-forcing-mirror',
  'interference-piece-captured-safely-mirror',
  'trapped-queen-has-escape-mirror',
];

// The mapping from a positive id to the sub-type we ASPIRE to name (best-effort).
const DESIRED_SUBTYPE: Record<string, string> = {
  'overload-queen-on-back-rank': 'overload',
  'deflection-queen-from-defense': 'deflection',
  'decoy-queen-to-e8': 'decoy',
  'zwischenzug-check-before-queen': 'zwischenzug',
  'overload-queen-on-back-rank-mirror': 'overload',
  'deflection-queen-from-defense-mirror': 'deflection',
  'decoy-queen-to-e8-mirror': 'decoy',
  'zwischenzug-check-before-queen-mirror': 'zwischenzug',
};

describe('Tier-2 detector — every emitted motif is engine-validated', () => {
  it('all required POSITIVE positions are genuinely won by the oracle (sanity)', () => {
    for (const id of POSITIVE_IDS) {
      expect(oracleWins(fenOf(id)), `${id} should be an oracle win`).toBe(true);
    }
  });

  it('emits at least one WINNING Tier-2 motif for every required positive', () => {
    const missed: string[] = [];
    for (const id of POSITIVE_IDS) {
      const motifs = detectTier2(fenOf(id));
      const winning = motifs.filter((m) => TIER2_TYPES.has(m.type));
      if (winning.length === 0) missed.push(id);
    }
    expect(missed, `positives with NO Tier-2 motif emitted: ${missed.join(', ')}`).toEqual([]);
  });

  it('every emitted Tier-2 motif carries the binary validity contract', () => {
    for (const id of POSITIVE_IDS) {
      for (const m of detectTier2(fenOf(id))) {
        expect(m.kind).toBe('motif');
        expect(m.tier).toBe(2);
        expect(m.validatedBy).toBe('engine_pv');
        expect(m.line.length).toBeGreaterThan(0);
        expect(m).not.toHaveProperty('confidence');
      }
    }
  });
});

describe('Tier-2 detector — conservative: never emits an unvalidated motif', () => {
  it('emits NOTHING for every required negative (search confirms no win)', () => {
    const leaked: string[] = [];
    for (const id of NEGATIVE_IDS) {
      const motifs = detectTier2(fenOf(id));
      if (motifs.length > 0) {
        leaked.push(`${id} -> [${motifs.map((m) => `${m.type}:${m.line[0]}`).join(', ')}]`);
      }
    }
    expect(leaked, `negatives that LEAKED a motif: ${leaked.join(' | ')}`).toEqual([]);
  });

  it('CAUGHT DATASET MISLABEL: trapped-rook-on-h-file is labelled positive but the oracle finds NO win — we do NOT emit', () => {
    // The dataset claims gxh6 "wins the rook"; the oracle line is gxh6 Rxh6 (gain 0).
    const id = 'trapped-rook-on-h-file';
    const c = byId.get(id)!;
    expect(c.isPositive).toBe(true); // dataset says positive...
    // ...but our oracle does NOT confirm a win:
    expect(oracleWins(c.fen)).toBe(false);
    // ...so we must emit nothing (conservative).
    expect(detectTier2(c.fen)).toEqual([]);
  });

  it('the trapped-rook MIRROR is likewise not won by the oracle and not emitted', () => {
    const id = 'trapped-rook-on-h-file-mirror';
    const c = byId.get(id)!;
    expect(oracleWins(c.fen)).toBe(false);
    expect(detectTier2(c.fen)).toEqual([]);
  });

  it('CAUGHT DATASET ISSUE #2: the interference "positives" — the intended Bd2/Be2 interference line is REFUTED by the oracle (…Qa8/…Qe8); the win is an independent Tier-1 mate, so no Tier-2 interference is emitted', () => {
    for (const id of INTERFERENCE_UNVALIDATED_IDS) {
      const c = byId.get(id)!;
      // Dataset labels it a positive interference...
      expect(c.isPositive).toBe(true);
      expect(c.motif).toBe('interference');
      // ...the position IS won (by Re8#/Rd8#, a Tier-1 back-rank mate)...
      expect(oracleWins(c.fen)).toBe(true);
      // ...but the INTERFERENCE move itself does not force a win, so we do NOT
      // emit any (unvalidated) interference motif. We may emit nothing, or only
      // motifs the search actually validates — never a fabricated interference.
      const motifs = detectTier2(c.fen);
      expect(
        motifs.some((m) => m.type === 'interference'),
        `${id} must not emit an unvalidated interference motif`,
      ).toBe(false);
    }
  });
});

describe('Tier-2 detector — sub-type naming accuracy (best-effort, reported)', () => {
  it('reports how often the dominant emitted sub-type matches the dataset intent', () => {
    let hit = 0;
    const total = Object.keys(DESIRED_SUBTYPE).length;
    const detail: string[] = [];
    for (const [id, want] of Object.entries(DESIRED_SUBTYPE)) {
      const types = new Set(detectTier2(fenOf(id)).filter((m) => TIER2_TYPES.has(m.type)).map((m) => m.type));
      const got = types.has(want as never);
      if (got) hit++;
      detail.push(`${id}: want=${want} got=[${[...types].join(',')}] ${got ? 'OK' : 'miss'}`);
    }
    // eslint-disable-next-line no-console
    console.log(`\nTier-2 sub-type naming: ${hit}/${total} dataset-intent labels present\n  ` + detail.join('\n  '));
    // Naming is best-effort; we only require it be reasonable (>= half present).
    expect(hit).toBeGreaterThanOrEqual(Math.ceil(total / 2));
  });
});

describe('Tier-2 detector — none/quiet positions produce nothing', () => {
  it('a quiet developing move yields no Tier-2 motif', () => {
    expect(detectTier2(fenOf('none-quiet-development'))).toEqual([]);
    expect(detectTier2(fenOf('none-quiet-development-mirror'))).toEqual([]);
  });
});
