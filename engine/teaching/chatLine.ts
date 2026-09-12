// Live chat curation: pick ONE claim worth saying, and say it in one line.
//
// This is the live-play sibling of the review pipeline (render.ts). Where render.ts emits a
// full ExplanationPlan (headline/cause/consequence/correction) for post-game teaching, chat
// gets ~140 characters, once per move at most, and is allowed to stay silent.
//
// Two things learned from measuring real positions (benchmarks/scripts/chat_curate_probe.py):
//
//   1. Render the FACT, never the hazard summary. Hazards are lossy: `pin_constraint`
//      carries the whole ray as `squares`, which produced lines like "pins a piece
//      (d1, e2, f3)". The pin/skewer/fork facts carry pinner → pinned → anchor,
//      skewerer → front → back, forkingPiece → targets, plus a validator-proven
//      worst-case materialGain.
//   2. Suppress hygiene. "answers material" fired on 24% of moves and reads as the engine
//      talking to itself; it is only worth a line when the removed hazard was
//      material/mate-significant. Likewise "the king is under pressure" with zero
//      attackers is just a cramped castled position, not pressure.
//
// Every emitted line carries the validators that proved it, and a stable dedupe key so a
// game never repeats the same claim. Fail closed: a collection that is uncomputed or
// unavailable contributes nothing.

import type {
  AttackDefenderOpportunity,
  DeflectionOpportunity,
  DesperadoOpportunity,
  DiscoveredDefenseOpportunity,
  DiscoveryOpportunity,
  DoubleAttackOpportunity,
  FactCollection,
  InterferenceOpportunity,
  LureDefenderOpportunity,
  MatePatternFact,
  MotifOpportunity,
  MoveStateFacts,
  OverloadOpportunity,
  PieceRef,
  PinOpportunity,
  PositionFacts,
  RemoveGuardOpportunity,
  SkewerOpportunity,
  TeachingFactBundleV1,
  TrappedPieceOpportunity,
  WinExchangeOpportunity,
  XRayDefenseOpportunity,
  XRayOpportunity,
} from './types';

export type ChatTier = 1 | 2 | 3 | 4 | 5;

export interface ChatLine {
  /** The one line to say. */
  text: string;
  /** Human topic, in the review vocabulary's style. */
  topic: string;
  /** Stable id for analytics/dedupe (delta-topics style). */
  conceptCode: string;
  tier: ChatTier;
  /** Validators that prove the claim; a line without provenance must not be spoken. */
  validators: string[];
  /** Squares a UI could highlight. */
  squares: string[];
  /** Dedupe key: same key must not be spoken twice in a game. */
  key: string;
}

export interface CurateOptions {
  /** Whose move the bundle's `played` branch describes. */
  subject: 'ours' | 'theirs';
  /** Move label for the sentence (SAN from the caller's board). Defaults to UCI. */
  moveLabel?: string;
  /** Claims already spoken this game (see ChatLine.key). */
  spoken?: ReadonlySet<string>;
  /** Minimum proven material for a material claim to count. Default 100 (one pawn). */
  minMaterialCp?: number;
  /** Chat length budget; longer candidates are dropped rather than truncated. */
  maxChars?: number;
}

interface Candidate extends ChatLine {
  score: number;
}

function items<T>(coll: FactCollection<T> | undefined): T[] {
  return coll && coll.status === 'computed' ? coll.items : [];
}

function piece(ref: PieceRef | undefined): string {
  if (!ref) return 'a piece';
  return `${ref.pieceType} on ${ref.square}`;
}

function list(refs: PieceRef[] | undefined, max = 2): string {
  const labels = (refs ?? []).map(piece).slice(0, max);
  if (labels.length === 0) return 'nothing';
  if (labels.length === 1) return labels[0] as string;
  return `${labels[0]} and ${labels[1]}`;
}

function pl(n: number): string {
  return (n / 100).toFixed(1);
}

/**
 * Pick one line worth saying about the move in `bundle.played`, or null.
 *
 * `subject: 'ours'`   — what our move created (motifs in `before` matching the played
 *                       move, plus hazard/structure deltas).
 * `subject: 'theirs'` — what their move newly allowed US: motifs available to the side
 *                       to move in `played.position` that were NOT available as
 *                       `before.opponentAvailable*` probes. Those twins exist precisely
 *                       so "newly allowed" is provable rather than guessed.
 */
export function curateChatLine(
  bundle: TeachingFactBundleV1,
  opts: CurateOptions,
): ChatLine | null {
  const minMat = opts.minMaterialCp ?? 100;
  const maxChars = opts.maxChars ?? 148;
  const label = opts.moveLabel ?? bundle.played.move.uci;
  const spoken = opts.spoken ?? new Set<string>();
  const cands: Candidate[] = [];

  const push = (c: Omit<Candidate, 'score'> & { score: number }): void => {
    if (c.text.length <= maxChars && !spoken.has(c.key)) cands.push(c);
  };

  if (opts.subject === 'ours') {
    collectOurs(bundle, label, minMat, push);
  } else {
    collectTheirs(bundle, label, minMat, push);
  }

  if (cands.length === 0) return null;
  cands.sort((a, b) => (a.tier !== b.tier ? a.tier - b.tier : b.score - a.score));
  const best = cands[0] as Candidate;
  const { score: _score, ...line } = best;
  return line;
}

type Push = (c: Candidate) => void;

function collectOurs(
  bundle: TeachingFactBundleV1,
  label: string,
  minMat: number,
  push: Push,
): void {
  const before = bundle.before;
  const played: MoveStateFacts = bundle.played;
  const mv = played.move.uci;
  const deltas = played.deltas;

  // ── T1: mate threats (created by the move, or waiting on it) ─────────────────
  for (const h of items(before.hazards)) {
    if (h.kind === 'mate_threat' && h.moveUci === mv) {
      const sq = h.squares.slice(0, 2).join(', ');
      push({
        tier: 1, score: 900 + (h.magnitudeCp ?? 0), topic: 'Mate threat',
        conceptCode: 'creates_mate_threat', validators: ['mate_pattern_validation'],
        squares: h.squares, key: `mate|${sq}`,
        text: `${label} creates a mate threat (${sq}).`,
      });
    }
  }
  for (const h of items(deltas.createdHazards)) {
    if (h.kind === 'mate_threat') {
      const sq = h.squares.slice(0, 2).join(', ');
      push({
        tier: 1, score: 880, topic: 'Mate threat', conceptCode: 'created_mate_threat',
        validators: ['mate_pattern_validation'], squares: h.squares, key: `mate|${sq}`,
        text: `${label} creates a mate threat (${sq}).`,
      });
    }
  }

  // ── T2: motifs whose move IS our move ────────────────────────────────────────
  motifLines(before, mv, label, minMat, 'ours', push);

  // ── T2b: a capture that simply wins material ─────────────────────────────────
  for (const c of items(before.availableCaptures)) {
    if (c.moveUci !== mv) continue;
    const see = c.seeCp ?? 0;
    if (see < minMat) continue;
    push({
      tier: 2, score: 600 + see, topic: 'Won material', conceptCode: 'winning_capture',
      validators: ['see'], squares: [c.victim?.square ?? c.victimSquare].filter(Boolean) as string[],
      key: `cap|${c.victimSquare}`,
      text: `${label} wins the ${piece(c.victim)} (${pl(see)}).`,
    });
  }

  // ── T3: quantified king pressure (needs real attackers, not a cramped king) ──
  for (const ks of items(before.kingSafety)) {
    if (ks.side !== before.sideToMove) continue;
    const attackers = ks.attackers?.length ?? 0;
    const escapes = ks.legalEscapeSquares;
    const nEsc = escapes && escapes.status === 'computed' ? escapes.items.length : undefined;
    if (attackers >= 2 && (nEsc === undefined || nEsc <= 2)) {
      const esc = nEsc === 0 ? 'no escape squares' : `${nEsc} escape squares`;
      push({
        tier: 3, score: 480 + 40 * attackers, topic: 'King pressure',
        conceptCode: 'created_king_pressure', validators: ['king_safety'],
        squares: [ks.kingSquare], key: `king|${ks.kingSquare}|${attackers}|${nEsc}`,
        text: `${label} keeps the king on ${ks.kingSquare} under pressure: ${attackers} attackers, ${esc}.`,
      });
    }
  }
  for (const h of items(deltas.createdHazards)) {
    const sq = h.squares.slice(0, 2).join(', ');
    if (h.kind === 'king_pressure') {
      push({
        tier: 3, score: 450, topic: 'King pressure', conceptCode: 'created_king_pressure',
        validators: ['king_safety'], squares: h.squares, key: `kp|${sq}`,
        text: `${label} adds pressure around the king (${sq}).`,
      });
    } else if (h.kind === 'losing_material' && (h.magnitudeCp ?? 0) >= minMat) {
      push({
        tier: 3, score: 430 + (h.magnitudeCp ?? 0), topic: 'Material threat',
        conceptCode: 'created_material_threat', validators: ['hazard_validation'],
        squares: h.squares, key: `lm|${sq}`,
        text: `${label} threatens to win material (${sq}).`,
      });
    }
    // pin_constraint is deliberately skipped: the pin facts say it with participants.
  }

  // ── T4: structure ────────────────────────────────────────────────────────────
  for (const sd of items(deltas.createdStructures)) {
    const kind = String(sd.kind ?? 'structure').replace(/_/g, ' ');
    const sq = (sd.squares ?? [])[0] ?? '';
    // "a isolated pawn" was the live output; and repeating the destination square the
    // move just named reads as noise ("b3 creates an isolated pawn (b3)").
    const article = /^[aeiou]/i.test(kind) ? 'an' : 'a';
    const where = sq && sq !== played.move.to ? ` on ${sq}` : '';
    push({
      tier: 4, score: 300, topic: 'Pawn structure', conceptCode: `created_${kind.replace(/ /g, '_')}`,
      validators: ['pawn_structure'], squares: sd.squares ?? [], key: `st|${kind}|${sq}`,
      text: `${label} creates ${article} ${kind}${where}.`,
    });
  }

  // ── T5: hazards answered — only the significant ones ─────────────────────────
  for (const h of items(deltas.removedHazards)) {
    const sq = h.squares.slice(0, 2).join(', ');
    if (h.kind === 'mate_threat') {
      push({
        tier: 5, score: 260, topic: 'Answered threat', conceptCode: 'answered_mate_threat',
        validators: ['mate_pattern_validation'], squares: h.squares, key: `rm|mate|${sq}`,
        text: `${label} answers the mate threat.`,
      });
    } else if (h.kind === 'losing_material' && (h.magnitudeCp ?? 0) >= minMat) {
      push({
        tier: 5, score: 250 + (h.magnitudeCp ?? 0), topic: 'Answered threat',
        conceptCode: 'removed_material_hazard', validators: ['hazard_validation'],
        squares: h.squares, key: `rm|lm|${sq}`,
        text: `${label} saves the material (${sq}).`,
      });
    }
  }
}

function collectTheirs(
  bundle: TeachingFactBundleV1,
  label: string,
  minMat: number,
  push: Push,
): void {
  // What WE can now do that we could not do before their move. `before` is the position
  // they moved in, where our opportunities appear as the opponent-side probes.
  const after: PositionFacts = bundle.played.position;
  const before: PositionFacts = bundle.before;
  const allowed = newlyAllowed(before, after);

  for (const { fact, family } of allowed) {
    const gain = 'materialGain' in fact ? Number(fact.materialGain ?? 0) : 0;
    if (gain < minMat && family !== 'pin' && family !== 'mate_pattern') continue;
    const subject = 'targets' in fact && Array.isArray(fact.targets) && fact.targets.length
      ? list(fact.targets as PieceRef[])
      : 'pinned' in fact && (fact as PinOpportunity).pinned
        ? piece((fact as PinOpportunity).pinned)
        : 'the position';
    const tail = gain >= minMat ? ` (wins about ${pl(gain)})` : '';
    push({
      tier: 2, score: 700 + gain, topic: `Allowed ${family.replace(/_/g, ' ')}`,
      conceptCode: `allowed_${family}`, validators: [String(fact.validator)],
      squares: squaresOf(fact), key: `allowed|${family}|${subject}`,
      text: `${label} allows ${family.replace(/_/g, ' ')}: ${subject}${tail}.`,
    });
  }

  // Their move handing us a structure problem is not teaching — skip.
  void minMat;
}

type AnyOpportunity =
  | MotifOpportunity | PinOpportunity | SkewerOpportunity | DiscoveryOpportunity
  | DiscoveredDefenseOpportunity | RemoveGuardOpportunity | TrappedPieceOpportunity
  | DesperadoOpportunity | MatePatternFact | OverloadOpportunity
  | AttackDefenderOpportunity | DeflectionOpportunity | LureDefenderOpportunity
  | InterferenceOpportunity | DoubleAttackOpportunity | XRayOpportunity
  | XRayDefenseOpportunity | WinExchangeOpportunity;

interface FamilyEntry {
  family: string;
  fact: AnyOpportunity;
}

/** Motif collections, in a stable order, with the `available*` field names. */
const OWN_COLLECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['availableMotifs', 'fork'],
  ['availablePins', 'pin'],
  ['availableSkewers', 'skewer'],
  ['availableDiscoveries', 'discovery'],
  ['availableDiscoveredDefense', 'discovered_defense'],
  ['availableRemoveGuard', 'capture_the_defender'],
  ['availableTrapped', 'trapped_piece'],
  ['availableDesperado', 'desperado'],
  ['availableMatePatterns', 'mate_pattern'],
  ['availableOverload', 'overload'],
  ['availableAttackDefender', 'attacking_the_defender'],
  ['availableDeflection', 'deflection'],
  ['availableLureDefender', 'luring_the_defender'],
  ['availableInterference', 'interference'],
  ['availableDoubleAttack', 'double_attack'],
  ['availableXrayAttack', 'xray_attack'],
  ['availableXrayDefense', 'xray_defense'],
  ['availableWinExchange', 'win_the_exchange'],
];

function allOf(pos: PositionFacts, field: string): AnyOpportunity[] {
  const coll = (pos as unknown as Record<string, FactCollection<AnyOpportunity> | undefined>)[field];
  return items(coll);
}

function opponentOf(field: string): string {
  return `opponent${field[0]?.toUpperCase() ?? ''}${field.slice(1)}`;
}

/** `moveUci` exists on most opportunity shapes but not all (trapped piece, overload). */
function moveOf(f: AnyOpportunity): string | undefined {
  return 'moveUci' in f ? (f as { moveUci?: string }).moveUci : undefined;
}

function identityOf(f: AnyOpportunity): string {
  return [
    f.validator, f.kind, moveOf(f) ?? '',
    ...squaresOf(f),
  ].join('|');
}

function squaresOf(f: AnyOpportunity): string[] {
  const rec = f as unknown as Record<string, unknown>;
  const out: string[] = [];
  for (const k of ['square', 'keySquares', 'ray', 'escapeSquaresTried']) {
    const v = rec[k];
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) out.push(...(v as string[]));
  }
  for (const k of ['forkingPiece', 'skewerer', 'pinner', 'pinned', 'anchor', 'front', 'back',
                   'mover', 'slider', 'target', 'piece', 'victim', 'xrayer', 'interposer',
                   'overloadedDefender', 'attackedDefender', 'distractedDefender',
                   'luredDefender', 'cutDefender', 'secondAttacker', 'targetA', 'targetB',
                   'capturedVictim', 'capturedDefender', 'defendedPiece', 'matingPiece',
                   'matedKing', 'frontEnemy', 'defended']) {
    const ref = rec[k] as PieceRef | undefined;
    if (ref?.square) out.push(ref.square);
  }
  for (const k of ['targets', 'attackers']) {
    const refs = rec[k] as PieceRef[] | undefined;
    if (Array.isArray(refs)) out.push(...refs.map((r) => r.square));
  }
  return [...new Set(out)];
}

function newlyAllowed(before: PositionFacts, after: PositionFacts): FamilyEntry[] {
  const had = new Set<string>();
  for (const [field] of OWN_COLLECTIONS) {
    for (const f of allOf(before, opponentOf(field))) had.add(identityOf(f));
  }
  const out: FamilyEntry[] = [];
  for (const [field, family] of OWN_COLLECTIONS) {
    for (const f of allOf(after, field)) {
      if (!had.has(identityOf(f))) out.push({ family, fact: f });
    }
  }
  return out;
}

function motifLines(
  before: PositionFacts,
  mv: string,
  label: string,
  minMat: number,
  subject: 'ours' | 'theirs',
  push: Push,
): void {
  const frame = (family: string) => (subject === 'ours' ? family : `allows ${family}`);
  for (const f of allOf(before, 'availableMotifs')) {
    if (moveOf(f) !== mv) continue;
    const fork = f as MotifOpportunity;
    const gain = fork.materialGain ?? 0;
    const chk = fork.givesCheck ? ' with check' : '';
    push({
      tier: 2, score: 800 + gain, topic: frame('fork'), conceptCode: 'created_fork',
      validators: [fork.validator], squares: squaresOf(fork), key: `fork|${list(fork.targets)}`,
      text: gain
        ? `${label} forks ${list(fork.targets)}${chk} — wins about ${pl(gain)}.`
        : `${label} forks ${list(fork.targets)}${chk}.`,
    });
  }
  for (const f of allOf(before, 'availablePins')) {
    if (moveOf(f) !== mv) continue;
    const pin = f as PinOpportunity;
    const toKing = pin.kind === 'absolute' || pin.anchor?.pieceType === 'king';
    const tail = pin.pinnedImmobile ? ' — it cannot move' : '';
    push({
      tier: 2, score: 780, topic: frame('pin'), conceptCode: toKing ? 'created_absolute_pin' : 'created_relative_pin',
      validators: [pin.validator], squares: squaresOf(pin), key: `pin|${pin.pinned?.square}`,
      text: toKing
        ? `${label} pins ${piece(pin.pinned)} to the king${tail}.`
        : `${label} pins ${piece(pin.pinned)} to ${piece(pin.anchor)}${tail}.`,
    });
  }
  for (const f of allOf(before, 'availableSkewers')) {
    if (moveOf(f) !== mv) continue;
    const sk = f as SkewerOpportunity;
    const gain = sk.materialGain ?? 0;
    push({
      tier: 2, score: 770 + gain, topic: frame('skewer'), conceptCode: 'created_skewer',
      validators: [sk.validator], squares: squaresOf(sk), key: `skewer|${sk.front?.square}`,
      text: gain
        ? `${label} skewers ${piece(sk.front)} and ${piece(sk.back)} — wins about ${pl(gain)}.`
        : `${label} skewers ${piece(sk.front)} and ${piece(sk.back)}.`,
    });
  }
  for (const f of allOf(before, 'availableDiscoveries')) {
    if (moveOf(f) !== mv) continue;
    const dv = f as DiscoveryOpportunity;
    const gain = dv.materialGain ?? 0;
    const kind = dv.doubleCheck ? 'a double check' : dv.discoveredCheck ? 'a discovered check' : 'a discovered attack';
    push({
      tier: 2, score: 760 + gain, topic: frame('discovery'), conceptCode: 'created_discovery',
      validators: [dv.validator], squares: squaresOf(dv), key: `disc|${dv.target?.square}`,
      text: gain
        ? `${label} unveils ${kind} on ${piece(dv.target)} — wins about ${pl(gain)}.`
        : `${label} unveils ${kind} on ${piece(dv.target)}.`,
    });
  }
  for (const f of allOf(before, 'availableRemoveGuard')) {
    if (moveOf(f) !== mv) continue;
    const rg = f as RemoveGuardOpportunity;
    const gain = rg.materialGain ?? 0;
    if (gain < minMat) continue;
    push({
      tier: 2, score: 740 + gain, topic: frame('capture the defender'), conceptCode: 'capture_the_defender',
      validators: [rg.validator], squares: squaresOf(rg), key: `rg|${rg.capturedDefender?.square}`,
      text: `${label} removes the guard of ${piece(rg.target)} — wins about ${pl(gain)}.`,
    });
  }
  for (const f of allOf(before, 'availableXrayAttack')) {
    if (moveOf(f) !== mv) continue;
    const xr = f as XRayOpportunity;
    const gain = xr.materialGain ?? 0;
    if (gain < minMat) continue;
    push({
      tier: 2, score: 730 + gain, topic: frame('x-ray'), conceptCode: 'created_xray_attack',
      validators: [xr.validator], squares: squaresOf(xr), key: `xray|${xr.front?.square}`,
      text: `${label} wins ${piece(xr.front)} by x-ray — ${pl(gain)} through to ${piece(xr.back)}.`,
    });
  }
  for (const f of allOf(before, 'availableDoubleAttack')) {
    if (moveOf(f) !== mv) continue;
    const da = f as DoubleAttackOpportunity;
    const gain = da.materialGain ?? 0;
    if (gain < minMat) continue;
    push({
      tier: 2, score: 720 + gain, topic: frame('double attack'), conceptCode: 'created_double_attack',
      validators: [da.validator], squares: squaresOf(da), key: `da|${da.targetA?.square}|${da.targetB?.square}`,
      text: `${label} double-attacks ${piece(da.targetA)} and ${piece(da.targetB)} — wins about ${pl(gain)}.`,
    });
  }
  for (const f of allOf(before, 'availableTrapped')) {
    const tp = f as TrappedPieceOpportunity;
    const gain = tp.materialGain ?? 0;
    if (gain < minMat) continue;
    push({
      tier: 2, score: 710 + gain, topic: frame('trapped piece'), conceptCode: 'trapped_piece',
      validators: [tp.validator], squares: squaresOf(tp), key: `trap|${tp.piece?.square}`,
      text: `${label} traps ${piece(tp.piece)} — every escape still loses it (${pl(gain)}).`,
    });
  }
  for (const f of allOf(before, 'availableDesperado')) {
    if (moveOf(f) !== mv) continue;
    const dp = f as DesperadoOpportunity;
    const gain = dp.materialGain ?? 0;
    push({
      tier: 2, score: 700 + gain, topic: frame('desperado'), conceptCode: 'created_desperado',
      validators: [dp.validator], squares: squaresOf(dp), key: `desp|${dp.piece?.square}`,
      text: `${label} sells ${piece(dp.piece)} for ${piece(dp.capturedVictim)} before it falls.`,
    });
  }
}

/** Filter a game-long series of moves down to a speakable cadence. */
export function cadenceAllows(
  spokenKeys: ReadonlySet<string>,
  pliesSinceLastLine: number,
  minPlies = 6,
): boolean {
  if (spokenKeys.size === 0) return true;
  return pliesSinceLastLine >= minPlies;
}
