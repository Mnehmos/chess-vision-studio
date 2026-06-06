// M6 DoD — every change/motif category renders a clean plain-English string and
// a topExplanation; zero LLM; STABLE string for stable input.
import { describe, it, expect } from 'vitest';
import { renderInsight } from '../explain';
import { findForks } from '../motif';
import type { ChangedRelation, ChangeType, Motif, MotifType } from '../types';

const baseChange = (over: Partial<ChangedRelation> & { type: ChangeType }): ChangedRelation => ({
  id: 'c',
  kind: 'changed_relation',
  side: 'white',
  squares: ['e5'],
  arrows: [],
  source: 'played_move',
  materialSwing: 0,
  kingSafetyDelta: 0,
  inPV: false,
  saliency: 0,
  templateId: over.templateId ?? over.type,
  evidence: [],
  ...over,
});

const baseMotif = (over: Partial<Motif> & { type: MotifType }): Motif => ({
  id: 'm',
  kind: 'motif',
  tier: 1,
  byPiece: 'wNc7',
  line: ['Nc7+', 'Kf8', 'Nxa8'],
  consequence: { materialSwing: 5 },
  proposedBy: 'geometry',
  validatedBy: 'see',
  side: 'white',
  squares: ['c7', 'a8', 'e8'],
  arrows: [],
  source: 'available',
  materialSwing: 5,
  kingSafetyDelta: 0,
  inPV: false,
  saliency: 0,
  templateId: over.type,
  evidence: [],
  ...over,
});

describe('M6 — every ChangeType renders a non-empty, clean string', () => {
  const types: ChangeType[] = [
    'piece_captured',
    'now_undefended',
    'now_defended',
    'now_see_losing',
    'defender_left',
    'line_opened',
    'line_closed',
    'check_created',
    'mate_threat',
    'escape_squares_changed',
  ];
  it.each(types)('%s', (t) => {
    const s = renderInsight(baseChange({ type: t, evidence: ['wP on e5: x'] }));
    expect(s.length).toBeGreaterThan(3);
    expect(s).not.toMatch(/undefined|NaN|\[object/);
  });
});

describe('M6 — every Tier-1 & Tier-2 MotifType renders a non-empty, clean string', () => {
  const types: MotifType[] = [
    'fork',
    'pin_absolute',
    'pin_relative',
    'skewer',
    'discovered_attack',
    'discovered_check',
    'back_rank',
    'removal_of_guard',
    'mating_net',
    'overload',
    'deflection',
    'decoy',
    'interference',
    'zwischenzug',
    'trapped_piece',
    'x_ray',
  ];
  it.each(types)('%s', (t) => {
    const s = renderInsight(baseMotif({ type: t }));
    expect(s.length).toBeGreaterThan(3);
    expect(s).not.toMatch(/undefined|NaN|\[object/);
  });
});

describe('M6 — the marquee topExplanation', () => {
  it('renders the "You missed a fork" line from a real validated fork', () => {
    const { motifs } = findForks('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1');
    const fork = { ...motifs.find((m) => m.type === 'fork')!, source: 'available' as const };
    const s = renderInsight(fork);
    expect(s).toContain('You missed a fork');
    expect(s).toContain('Nc7+');
    expect(s.toLowerCase()).toContain('rook'); // wins a rook
  });

  it('source changes the framing (miss vs threat vs neutral)', () => {
    expect(renderInsight(baseMotif({ type: 'fork', source: 'available' }))).toContain('You missed');
    expect(renderInsight(baseMotif({ type: 'fork', source: 'refutation' }))).toContain(
      'Your opponent has',
    );
  });
});

describe('M6 — deterministic: same input → same string', () => {
  it('is stable across calls (snapshot)', () => {
    const fork = baseMotif({ type: 'fork', source: 'available' });
    const a = renderInsight(fork);
    const b = renderInsight(fork);
    expect(a).toBe(b);
    expect(a).toMatchInlineSnapshot(
      `"You missed a fork — Nc7+ Kf8 Nxa8 forks a8 and e8, winning a rook."`,
    );
  });
});
