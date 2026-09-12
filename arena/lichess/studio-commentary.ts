// Commentary from the Chess Vision Studio itself, over its dev-server API.
//
// The bot does not re-implement the teaching pipeline: it asks the running studio for
//   1. POST /api/cvs-engine/facts    -> the versioned TeachingFactBundleV1 (Rust truth)
//   2. POST /api/cvs-engine/analyze  -> evalBefore / evalAfter (our engine, mapped into
//                                       the studio's Eval shape)
// then hands those to `analyzeMove`, the studio's own per-ply commentary entry point,
// which derives cpLoss -> classification, builds its diff insights, appends the
// validated motifs we pass as `extraCandidates`, RE-SCORES every candidate with its
// saliency weights, and renders the top one through `explain.ts`'s deterministic
// templates.
//
// Why this shape: the studio already owns the vocabulary and the invariants (tactical
// validity is binary; a claim may never exceed the eval budget; "White/Black", never
// "you/opponent"), and running it live means the bot and the app explain a move the
// same way.
import { Chess } from 'chess.js';
import { analyzeMove } from '../../engine/saliency';
import { renderInsight } from '../../engine/explain';
import type { Eval, InsightCandidate, Motif, MotifType, Square } from '../../engine/types';
import type { PieceRef, TeachingFactBundleV1 } from '../../engine/teaching/types';

export interface StudioLine {
  /** Chat-ready line, prefixed with the move number it belongs to. */
  text: string;
  topic: string;
  classification: string;
  saliency: number;
  /** Engine motif families (or change types) the line rests on, for provenance. */
  evidence: string[];
}

export interface StudioCommentaryOptions {
  baseUrl: string;
  /** Depth for each side's eval (before/after). Default 12. */
  depth?: number;
  /** Chat length budget. Default 200. */
  maxChars?: number;
  timeoutMs?: number;
}

interface RustAnalyze {
  scoreCp?: number;
  mate?: number | null;
  depth?: number;
  pv?: string[];
  error?: string;
}

function uciPvToSan(fen: string, pv: string[]): string[] {
  const board = new Chess(fen);
  const out: string[] = [];
  for (const uci of pv) {
    try {
      const moved = board.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
      });
      if (!moved) break;
      out.push(moved.san);
    } catch {
      break;
    }
  }
  return out;
}

async function postJson<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchFacts(
  opts: StudioCommentaryOptions,
  fenBefore: string,
  playedMoveUci: string,
): Promise<TeachingFactBundleV1> {
  return postJson<TeachingFactBundleV1>(
    `${opts.baseUrl}/api/cvs-engine/facts`,
    {
      schemaVersion: 1,
      fenBefore,
      playedMoveUci,
      options: { includeMotifOpportunities: true, includeCounterfactual: true },
    },
    opts.timeoutMs ?? 20_000,
  );
}

/** Our engine's search of `fen`, mapped into the studio's Eval shape (pv in SAN). */
export async function fetchEval(
  opts: StudioCommentaryOptions,
  fen: string,
): Promise<Eval> {
  const depth = opts.depth ?? 12;
  try {
    const out = await postJson<RustAnalyze>(
      `${opts.baseUrl}/api/cvs-engine/analyze`,
      { fen, depth },
      opts.timeoutMs ?? 20_000,
    );
    if (out.error) return { depth: 0, pv: [], status: 'unavailable', reason: 'engine_error' };
    const mate = typeof out.mate === 'number' ? out.mate : undefined;
    if (mate !== undefined && mate !== 0) {
      return { mate, depth: out.depth ?? depth, pv: uciPvToSan(fen, out.pv ?? []), status: 'ok' };
    }
    return {
      cp: out.scoreCp ?? 0,
      depth: out.depth ?? depth,
      pv: uciPvToSan(fen, out.pv ?? []),
      status: 'ok',
    };
  } catch {
    return { depth: 0, pv: [], status: 'unavailable', reason: 'engine_error' };
  }
}

// ── facts -> studio insight candidates ───────────────────────────────────────
// Only VALIDATED material (engine `materialGain`, an SEE swap, or a proven motif) is
// mapped; the studio re-scores saliency itself and drops any claim that exceeds the
// eval budget, so over-claiming here is safe by construction — it just gets filtered.

const MOTIF_TYPE: Record<string, MotifType> = {
  fork: 'fork',
  skewer: 'skewer',
  remove_guard: 'removal_of_guard',
  capture_the_defender: 'removal_of_guard',
  trapped_piece: 'trapped_piece',
  overload: 'overload',
  overloading: 'overload',
  deflection: 'deflection',
  lure_defender: 'decoy',
  luring_the_defender: 'decoy',
  interference: 'interference',
  double_attack: 'fork',
  xray_attack: 'x_ray',
  win_the_exchange: 'removal_of_guard',
  mate_pattern: 'mating_net',
  discovered_attack: 'discovered_attack',
  discovered_check: 'discovered_check',
  double_check: 'discovered_check',
  discoverer_checks: 'discovered_attack',
  back_rank_mate: 'back_rank',
};

/** Collections whose items carry a `moveUci` we can match against the played move. */
const MOVE_KEYED: ReadonlyArray<[string, string]> = [
  ['availableMotifs', 'fork'],
  ['availablePins', 'pin'],
  ['availableSkewers', 'skewer'],
  ['availableDiscoveries', 'discovery'],
  ['availableRemoveGuard', 'remove_guard'],
  ['availableDesperado', 'desperado'],
  ['availableMatePatterns', 'mate_pattern'],
  ['availableAttackDefender', 'attack_defender'],
  ['availableDeflection', 'deflection'],
  ['availableLureDefender', 'lure_defender'],
  ['availableInterference', 'interference'],
  ['availableDoubleAttack', 'double_attack'],
  ['availableXrayAttack', 'xray_attack'],
  ['availableWinExchange', 'win_exchange'],
  ['availableOverload', 'overload'],
];

function items<T>(coll: unknown): T[] {
  const c = coll as { status?: string; items?: T[] } | undefined;
  return c && c.status === 'computed' && Array.isArray(c.items) ? c.items : [];
}

function squaresOf(fact: Record<string, unknown>): Square[] {
  const out = new Set<string>();
  const push = (v: unknown): void => {
    if (typeof v === 'string' && /^[a-h][1-8]$/.test(v)) out.add(v);
    else if (Array.isArray(v)) v.forEach(push);
  };
  for (const [k, v] of Object.entries(fact)) {
    if (k === 'ray' || k === 'keySquares' || k === 'escapeSquaresTried' || k === 'squares') push(v);
    else if (v && typeof v === 'object' && 'square' in (v as Record<string, unknown>)) {
      push((v as { square?: unknown }).square);
    }
  }
  return [...out] as Square[];
}

function byPieceOf(fact: Record<string, unknown>): PieceRef | undefined {
  for (const k of ['forkingPiece', 'pinner', 'skewerer', 'mover', 'interposer', 'xrayer', 'piece', 'matingPiece']) {
    const ref = fact[k] as PieceRef | undefined;
    if (ref?.square) return ref;
  }
  return undefined;
}

export function factsToInsights(
  bundle: TeachingFactBundleV1,
  san: string,
  moverSide: 'white' | 'black',
): InsightCandidate[] {
  const playedUci = bundle.played.move.uci;
  const before = bundle.before as unknown as Record<string, unknown>;
  const out: InsightCandidate[] = [];

  let n = 0;
  for (const [field, family] of MOVE_KEYED) {
    for (const fact of items<Record<string, unknown>>(before[field])) {
      if (fact.moveUci !== playedUci) continue;
      const kind = String(fact.kind ?? family);
      const isPin = family === 'pin';
      const type: MotifType | undefined = isPin
        ? kind === 'absolute'
          ? 'pin_absolute'
          : 'pin_relative'
        : MOTIF_TYPE[kind];
      if (!type) continue;
      const gainCp = Number(fact.materialGain ?? 0);
      const ref = byPieceOf(fact);
      const squares = squaresOf(fact);
      const motif: Motif = {
        id: `cvs-${field}-${n++}`,
        kind: 'motif',
        type,
        tier: gainCp >= 100 || isPin ? 1 : 2,
        side: moverSide,
        squares,
        arrows: [],
        source: 'played_move',
        materialSwing: gainCp / 100,
        kingSafetyDelta: 0,
        inPV: false,
        saliency: 0, // derived by analyzeMove's ranker
        templateId: type,
        evidence: [
          `${String(fact.validator ?? kind)}: ${String(fact.moveUci)} ${kind}` +
            (gainCp ? ` wins ${(gainCp / 100).toFixed(1)}` : ''),
        ],
        byPiece: (ref?.id ?? `unknown-${n}`) as Motif['byPiece'],
        line: [san],
        consequence: { materialSwing: gainCp / 100 },
        proposedBy: 'geometry',
        validatedBy: gainCp > 0 ? 'see' : 'geometry',
      };
      out.push(motif);
    }
  }
  return out;
}

// ── the line ─────────────────────────────────────────────────────────────────

/** `12.` for White's move, `12...` for Black's — chat lines must say which move they
 *  are about, or a reader cannot tell when the commentary applies. */
export function movePrefix(ply: number): string {
  const moveNumber = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${moveNumber}.` : `${moveNumber}...`;
}

/**
 * One studio-voiced line about the move, or null when the studio has nothing to add
 * (unavailable eval, low-salience fallback, or a claim that does not fit the budget).
 */
export async function studioLine(
  opts: StudioCommentaryOptions,
  params: { fenBefore: string; fenAfter: string; uci: string; san: string; ply: number; mover: 'white' | 'black' },
): Promise<StudioLine | null> {
  const [bundle, evalBefore, evalAfter] = await Promise.all([
    fetchFacts(opts, params.fenBefore, params.uci),
    fetchEval(opts, params.fenBefore),
    fetchEval(opts, params.fenAfter),
  ]);
  if (evalBefore.status === 'unavailable' && evalAfter.status === 'unavailable') return null;

  const extraCandidates = factsToInsights(bundle, params.san, params.mover);
  const analysis = analyzeMove(
    {
      fenBefore: params.fenBefore,
      fenAfter: params.fenAfter,
      san: params.san,
      evalBefore,
      evalAfter,
    },
    extraCandidates,
  );

  const top = analysis.rankedInsights[0];
  const text = top ? renderInsight(top) : analysis.topExplanation;
  if (!text) return null;
  if (/analysis unavailable/i.test(text)) return null;

  // The studio's composition path ("11. Nxe5 — captures on e5 …") already carries a move
  // number from the FEN; its insight path does not. Prefix only when it is missing, or
  // live chat reads "11. 11. Nxe5 — …".
  const prefixed = /^\d+\.{1,3}\s/.test(text.trim())
    ? text
    : `${movePrefix(params.ply)} ${text}`;
  const line = prefixed.replace(/\s+/g, ' ').trim();
  const maxChars = opts.maxChars ?? 200;
  if (line.length > maxChars) return null; // drop rather than truncate mid-claim

  return {
    text: line,
    topic: top ? `${top.kind}:${top.kind === 'motif' ? top.type : top.templateId}` : analysis.classification,
    classification: analysis.classification,
    saliency: top?.saliency ?? 0,
    evidence: top?.evidence ?? [],
  };
}
