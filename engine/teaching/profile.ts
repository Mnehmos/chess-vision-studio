import type { MoveAnalysis } from '../types';
import { compileTeachingEvents } from './compile';
import type { TeachingEvent, TeachingFactBundleV1, TeachingFamily, TeachingTopicId } from './types';

// Aggregate committed teaching events across a PGN dataset into a player profile:
// which topics recur, how severe, in which phase, with linkable examples. Pure —
// the caller supplies committed events tagged with game/ply/phase; this never
// touches the board. Attribution belongs to the player who made the move
// (event.side), per the dataset discipline.

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

export interface TeachingSample {
  event: TeachingEvent;
  gameKey: string;
  ply: number; // half-move index
  phase: GamePhase;
}

export interface TeachingExample {
  gameKey: string;
  ply: number;
  topicId: TeachingTopicId;
  severity: number;
  cpLoss: number;
  headline: string;
  squares: string[];
}

export interface TopicStats {
  count: number;
  avgSeverity: number;
  avgCpLoss: number;
  byPhase: Record<GamePhase, number>;
  allowed: number;
  missed: number;
  topSquares: string[];
  examples: TeachingExample[];
}

export interface TeachingProfile {
  total: number;
  byTopic: Partial<Record<TeachingTopicId, TopicStats>>;
  byFamily: Partial<Record<TeachingFamily, TopicStats>>;
  byPhase: Record<GamePhase, number>;
  byColor: { white: number; black: number };
  worstExamples: TeachingExample[];
}

interface Acc {
  count: number;
  sevSum: number;
  cpSum: number;
  byPhase: Record<GamePhase, number>;
  allowed: number;
  missed: number;
  squares: Map<string, number>;
  examples: TeachingExample[];
}

function emptyPhase(): Record<GamePhase, number> {
  return { opening: 0, middlegame: 0, endgame: 0 };
}

function toExample(s: TeachingSample): TeachingExample {
  return {
    gameKey: s.gameKey,
    ply: s.ply,
    topicId: s.event.topicId,
    severity: s.event.saliency,
    cpLoss: s.event.consequence.cpLoss,
    headline: s.event.plan.headline,
    squares: [...s.event.squares],
  };
}

function rankExamples(examples: TeachingExample[]): TeachingExample[] {
  return [...examples].sort(
    (a, b) =>
      b.severity - a.severity ||
      b.cpLoss - a.cpLoss ||
      a.gameKey.localeCompare(b.gameKey) ||
      a.ply - b.ply,
  );
}

function bump<K>(map: Map<K, Acc>, key: K, s: TeachingSample, ex: TeachingExample): void {
  let acc = map.get(key);
  if (!acc) {
    acc = {
      count: 0,
      sevSum: 0,
      cpSum: 0,
      byPhase: emptyPhase(),
      allowed: 0,
      missed: 0,
      squares: new Map(),
      examples: [],
    };
    map.set(key, acc);
  }
  acc.count += 1;
  acc.sevSum += s.event.saliency;
  acc.cpSum += s.event.consequence.cpLoss;
  acc.byPhase[s.phase] += 1;
  if (s.event.action === 'allowed') acc.allowed += 1;
  if (s.event.action === 'missed') acc.missed += 1;
  for (const sq of s.event.squares) acc.squares.set(sq, (acc.squares.get(sq) ?? 0) + 1);
  acc.examples.push(ex);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function project<K extends string>(map: Map<K, Acc>): Partial<Record<K, TopicStats>> {
  const out: Partial<Record<K, TopicStats>> = {};
  for (const [key, acc] of map) {
    const topSquares = [...acc.squares.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([sq]) => sq);
    out[key] = {
      count: acc.count,
      avgSeverity: round3(acc.sevSum / acc.count),
      avgCpLoss: round3(acc.cpSum / acc.count),
      byPhase: acc.byPhase,
      allowed: acc.allowed,
      missed: acc.missed,
      topSquares,
      examples: rankExamples(acc.examples).slice(0, 3),
    };
  }
  return out;
}

export function buildTeachingProfile(samples: TeachingSample[]): TeachingProfile {
  const topic = new Map<TeachingTopicId, Acc>();
  const family = new Map<TeachingFamily, Acc>();
  const byPhase = emptyPhase();
  const byColor = { white: 0, black: 0 };
  const allExamples: TeachingExample[] = [];

  for (const s of samples) {
    const ex = toExample(s);
    allExamples.push(ex);
    byPhase[s.phase] += 1;
    byColor[s.event.side] += 1;
    bump(topic, s.event.topicId, s, ex);
    bump(family, s.event.family, s, ex);
  }

  return {
    total: samples.length,
    byTopic: project(topic),
    byFamily: project(family),
    byPhase,
    byColor,
    worstExamples: rankExamples(allExamples).slice(0, 10),
  };
}

// Deterministic game-phase classifier: light material → endgame regardless of move
// number; otherwise the first 20 half-moves are the opening, then the middlegame.
// Heavy material is weighted N/B=1, R=2, Q=4 (both sides), starting total 24.
export function classifyPhase(plyIndex: number, fen: string): GamePhase {
  if (heavyMaterial(fen) <= 6) return 'endgame';
  if (plyIndex < 20) return 'opening';
  return 'middlegame';
}

function heavyMaterial(fen: string): number {
  const board = fen.split(' ')[0] ?? '';
  const weight: Record<string, number> = { n: 1, b: 1, r: 2, q: 4 };
  let total = 0;
  for (const ch of board) {
    total += weight[ch.toLowerCase()] ?? 0;
  }
  return total;
}

// One analyzed ply paired with its Rust fact bundle — the unit a dataset-wide pass
// produces (fetching facts per ply via the bridge is the caller's job).
export interface PlyTeachingInput {
  gameKey: string;
  ply: number;
  fenBefore: string;
  analysis: MoveAnalysis;
  facts: TeachingFactBundleV1;
}

// Compile every ply's events and flatten into phase-tagged samples. The bridge
// fetch is the caller's; this glue is pure so it stays testable. A ply whose facts
// fail to compile (schema mismatch) is skipped, never counted as "no mistake".
export function collectTeachingSamples(inputs: PlyTeachingInput[]): TeachingSample[] {
  const samples: TeachingSample[] = [];
  for (const input of inputs) {
    const result = compileTeachingEvents({ analysis: input.analysis, facts: input.facts });
    if (!result.computed) continue;
    const phase = classifyPhase(input.ply, input.fenBefore);
    for (const event of result.events) {
      samples.push({ event, gameKey: input.gameKey, ply: input.ply, phase });
    }
  }
  return samples;
}

export function buildDatasetTeachingProfile(inputs: PlyTeachingInput[]): TeachingProfile {
  return buildTeachingProfile(collectTeachingSamples(inputs));
}
