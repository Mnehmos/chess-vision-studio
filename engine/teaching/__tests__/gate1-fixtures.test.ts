import { describe, expect, it } from 'vitest';
import allowedFork from '../../../fixtures/teaching-facts/v1/allowed-fork.json';
import allowedPin from '../../../fixtures/teaching-facts/v1/allowed-pin.json';
import failedDefense from '../../../fixtures/teaching-facts/v1/failed-defense.json';
import missedHanging from '../../../fixtures/teaching-facts/v1/missed-hanging-piece.json';
import pawnDamage from '../../../fixtures/teaching-facts/v1/pawn-structure-damage.json';
import type { MoveAnalysis } from '../../types';
import { compileTeachingEvents } from '../compile';
import type { TeachingFactBundleV1, TeachingTopicId } from '../types';

type MutableFacts = TeachingFactBundleV1;
type NegativeCase = {
  name: string;
  mutateFacts?: (facts: MutableFacts) => void;
  mutateAnalysis?: (analysis: MoveAnalysis) => void;
};

interface TopicFixture {
  topic: TeachingTopicId;
  facts: unknown;
  analysis: Omit<MoveAnalysis, 'positionBefore' | 'positionAfter'>;
  negatives: NegativeCase[];
}

const clone = <T,>(value: T): T => structuredClone(value);
const computedItems = <T,>(items: T[]) => ({ status: 'computed' as const, items });

function baseAnalysis(
  facts: TeachingFactBundleV1,
  template: TopicFixture['analysis'],
  variant = 0,
): MoveAnalysis {
  return {
    ...clone(template),
    positionBefore: facts.fenBefore,
    positionAfter: facts.played.fenAfter,
    cpLoss: template.cpLoss + variant / 100,
  } as MoveAnalysis;
}

function fixture(
  topic: TeachingTopicId,
  facts: unknown,
  analysis: TopicFixture['analysis'],
  negatives: NegativeCase[],
): TopicFixture {
  if (negatives.length !== 10) throw new Error(`${topic} must define exactly ten hard negatives`);
  return { topic, facts, analysis, negatives };
}

const TOPICS: TopicFixture[] = [
  fixture(
    'allowed_fork',
    allowedFork,
    {
      move: 'e4',
      classification: 'blunder',
      evalBefore: { cp: 0, depth: 14, pv: ['Kh1'] },
      evalAfter: { cp: -500, depth: 14, pv: ['Nf3+'] },
      cpLoss: 5,
      rankedInsights: [],
      topExplanation: '',
    },
    [
      { name: 'no played fork', mutateFacts: (f) => { f.played.position.availableMotifs = computedItems([]); } },
      { name: 'played motifs uncomputed', mutateFacts: (f) => { f.played.position.availableMotifs = { status: 'uncomputed', reason: 'test' }; } },
      { name: 'played motifs unavailable', mutateFacts: (f) => { f.played.position.availableMotifs = { status: 'unavailable', reason: 'test' }; } },
      { name: 'fork already existed', mutateFacts: (f) => { f.before.opponentAvailableMotifs = clone(f.played.position.availableMotifs); } },
      { name: 'before motifs uncomputed', mutateFacts: (f) => { f.before.opponentAvailableMotifs = { status: 'uncomputed', reason: 'test' }; } },
      { name: 'before motifs unavailable', mutateFacts: (f) => { f.before.opponentAvailableMotifs = { status: 'unavailable', reason: 'test' }; } },
      { name: 'no refutation or best branch', mutateFacts: (f) => { delete f.refutation; delete f.best; } },
      { name: 'refutation mismatch without best branch', mutateFacts: (f) => { if (f.refutation) f.refutation.move.uci = 'a1a2'; delete f.best; } },
      { name: 'best also concedes fork', mutateFacts: (f) => { if (f.refutation) f.refutation.move.uci = 'a1a2'; if (f.best) f.best.position.availableMotifs = clone(f.played.position.availableMotifs); } },
      { name: 'causal branches absent', mutateFacts: (f) => { delete f.refutation; if (f.best) f.best.position.availableMotifs = clone(f.played.position.availableMotifs); } },
    ],
  ),
  fixture(
    'allowed_pin',
    allowedPin,
    {
      move: 'Kd1',
      classification: 'mistake',
      evalBefore: { cp: 0, depth: 14, pv: ['h3'] },
      evalAfter: { cp: -150, depth: 14, pv: ['Bg4'] },
      cpLoss: 1.5,
      rankedInsights: [],
      topExplanation: '',
    },
    [
      { name: 'no played pin', mutateFacts: (f) => { f.played.position.availablePins = computedItems([]); } },
      { name: 'played pins uncomputed', mutateFacts: (f) => { f.played.position.availablePins = { status: 'uncomputed', reason: 'test' }; } },
      { name: 'played pins unavailable', mutateFacts: (f) => { f.played.position.availablePins = { status: 'unavailable', reason: 'test' }; } },
      { name: 'pin already existed', mutateFacts: (f) => { f.before.opponentAvailablePins = clone(f.played.position.availablePins); } },
      { name: 'before pins uncomputed', mutateFacts: (f) => { f.before.opponentAvailablePins = { status: 'uncomputed', reason: 'test' }; } },
      { name: 'before pins unavailable', mutateFacts: (f) => { f.before.opponentAvailablePins = { status: 'unavailable', reason: 'test' }; } },
      { name: 'no refutation or best branch', mutateFacts: (f) => { delete f.refutation; delete f.best; } },
      { name: 'refutation mismatch without best branch', mutateFacts: (f) => { if (f.refutation) f.refutation.move.uci = 'a1a2'; delete f.best; } },
      { name: 'best also concedes pin', mutateFacts: (f) => { if (f.refutation) f.refutation.move.uci = 'a1a2'; if (f.best) f.best.position.availablePins = clone(f.played.position.availablePins); } },
      { name: 'relative mobile pin lacks concrete line', mutateFacts: (f) => { delete f.refutation; if (f.played.position.availablePins.status === 'computed') { f.played.position.availablePins.items[0].kind = 'relative'; f.played.position.availablePins.items[0].pinnedImmobile = false; } } },
    ],
  ),
  fixture(
    'missed_hanging_piece',
    missedHanging,
    {
      move: 'Kf1',
      classification: 'blunder',
      evalBefore: { cp: 0, depth: 14, pv: ['Nxe5'] },
      evalAfter: { cp: -900, depth: 14, pv: ['Qb2'] },
      cpLoss: 9,
      rankedInsights: [],
      topExplanation: '',
    },
    [
      { name: 'good move classification', mutateAnalysis: (a) => { a.classification = 'best'; } },
      { name: 'best branch absent', mutateFacts: (f) => { delete f.best; } },
      { name: 'best move is not capture', mutateFacts: (f) => { if (f.best) f.best.move.uci = 'e1d1'; } },
      { name: 'played move took target', mutateFacts: (f) => { f.played.move.uci = 'f3e5'; } },
      { name: 'target absent before move', mutateFacts: (f) => { f.before.pieces = f.before.pieces.filter((p) => p.id !== 'black-queen-e5'); } },
      { name: 'target SEE unavailable', mutateFacts: (f) => { const p = f.before.pieces.find((x) => x.id === 'black-queen-e5'); if (p) p.see = { status: 'unavailable', reason: 'test' }; } },
      { name: 'target is not losing', mutateFacts: (f) => { const p = f.before.pieces.find((x) => x.id === 'black-queen-e5'); if (p?.see.status === 'computed') p.see.value.losing = false; } },
      { name: 'capture identity absent', mutateFacts: (f) => { const p = f.before.pieces.find((x) => x.id === 'black-queen-e5'); if (p?.see.status === 'computed') delete p.see.value.bestCaptureUci; } },
      { name: 'refutation branch absent', mutateFacts: (f) => { delete f.refutation; } },
      { name: 'capture remains available', mutateFacts: (f) => { const p = f.before.pieces.find((x) => x.id === 'black-queen-e5'); if (p && f.refutation) f.refutation.position.pieces.push(clone(p)); } },
    ],
  ),
  fixture(
    'failed_defense',
    failedDefense,
    {
      move: 'Kf2',
      classification: 'mistake',
      evalBefore: { cp: 0, depth: 14, pv: ['Rc3'] },
      evalAfter: { cp: -500, depth: 14, pv: ['Bxc2'] },
      cpLoss: 5,
      rankedInsights: [],
      topExplanation: '',
    },
    [
      { name: 'good move classification', mutateAnalysis: (a) => { a.classification = 'excellent'; } },
      { name: 'refutation absent', mutateFacts: (f) => { delete f.refutation; } },
      { name: 'best branch absent', mutateFacts: (f) => { delete f.best; } },
      { name: 'before hazards empty', mutateFacts: (f) => { f.before.hazards = computedItems([]); } },
      { name: 'before hazards unavailable', mutateFacts: (f) => { f.before.hazards = { status: 'unavailable', reason: 'test' }; } },
      { name: 'played move resolves hazard', mutateFacts: (f) => { f.played.position.hazards = computedItems([]); } },
      { name: 'best move leaves hazard', mutateFacts: (f) => { if (f.best) f.best.position.hazards = clone(f.before.hazards); } },
      { name: 'refutation does not realize hazard', mutateFacts: (f) => { if (f.refutation) f.refutation.move.uci = 'a1a2'; } },
      { name: 'hazard belongs to opponent', mutateFacts: (f) => { if (f.before.hazards.status === 'computed') f.before.hazards.items[0].side = 'black'; } },
      { name: 'unsupported hazard category', mutateFacts: (f) => { if (f.before.hazards.status === 'computed') f.before.hazards.items[0].kind = 'unsupported'; } },
    ],
  ),
  fixture(
    'pawn_structure_damage',
    pawnDamage,
    {
      move: 'bxc4',
      classification: 'mistake',
      evalBefore: { cp: 0, depth: 12, pv: ['c3'] },
      evalAfter: { cp: 0, depth: 12, pv: [] },
      cpLoss: 1.4,
      rankedInsights: [],
      topExplanation: '',
    },
    [
      { name: 'no created structures', mutateFacts: (f) => { f.played.deltas.createdStructures = computedItems([]); } },
      { name: 'created structures uncomputed', mutateFacts: (f) => { f.played.deltas.createdStructures = { status: 'uncomputed', reason: 'test' }; } },
      { name: 'created structures unavailable', mutateFacts: (f) => { f.played.deltas.createdStructures = { status: 'unavailable', reason: 'test' }; } },
      { name: 'only beneficial passed pawn', mutateFacts: (f) => { if (f.played.deltas.createdStructures.status === 'computed') f.played.deltas.createdStructures.items.forEach((x) => { x.kind = 'passed_pawn'; }); } },
      { name: 'damage belongs to opponent', mutateFacts: (f) => { if (f.played.deltas.createdStructures.status === 'computed') f.played.deltas.createdStructures.items.forEach((x) => { x.side = 'black'; }); } },
      { name: 'damage merely relocated', mutateFacts: (f) => { f.played.deltas.removedStructures = clone(f.played.deltas.createdStructures); } },
      { name: 'more damage removed than created', mutateFacts: (f) => { if (f.played.deltas.createdStructures.status === 'computed') { const items = clone(f.played.deltas.createdStructures.items); f.played.deltas.removedStructures = computedItems([...items, ...clone(items)]); } } },
      { name: 'unknown structure kind', mutateFacts: (f) => { if (f.played.deltas.createdStructures.status === 'computed') f.played.deltas.createdStructures.items.forEach((x) => { x.kind = 'unknown'; }); } },
      { name: 'played deltas omit damage collection', mutateFacts: (f) => { delete (f.played.deltas as Partial<typeof f.played.deltas>).createdStructures; } },
      { name: 'schema mismatch fails closed', mutateFacts: (f) => { (f as { schemaVersion: number }).schemaVersion = 2; } },
    ],
  ),
];

describe('Gate 1 teaching fixtures', () => {
  for (const topic of TOPICS) {
    describe(topic.topic, () => {
      for (let index = 0; index < 10; index += 1) {
        it(`positive ${index + 1}: survives deterministic judgment variant ${index + 1}`, () => {
          const facts = clone(topic.facts) as TeachingFactBundleV1;
          const analysis = baseAnalysis(facts, topic.analysis, index);
          const result = compileTeachingEvents({ analysis, facts });
          expect(result.computed).toBe(true);
          if (!result.computed) return;
          expect(result.events.some((event) => event.topicId === topic.topic)).toBe(true);
        });
      }

      for (const negative of topic.negatives) {
        it(`hard negative: ${negative.name}`, () => {
          const facts = clone(topic.facts) as TeachingFactBundleV1;
          const analysis = baseAnalysis(facts, topic.analysis);
          negative.mutateFacts?.(facts);
          negative.mutateAnalysis?.(analysis);
          const result = compileTeachingEvents({ analysis, facts });
          expect(result.computed ? result.events.some((event) => event.topicId === topic.topic) : false).toBe(false);
        });
      }
    });
  }
});
