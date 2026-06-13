import type {
  CaptureOpportunity,
  MotifOpportunity,
  PieceRef,
  PinOpportunity,
  TeachingFactBundleV1,
} from './types';

// What a move ACCOMPLISHES — the tactical idea behind it — read straight from the
// validated Rust opportunity facts for the position BEFORE the move. The played
// move's UCI matching a fork/pin/capture opportunity means the move executed that
// tactic, so we can describe its real targets. This is the positive complement to
// the mistake compiler: it explains strong moves (a queen fork, a pin, a winning
// capture) instead of only flagging blunders. No invented tactics — every clause
// is a named, validated opportunity.

export interface MoveIdea {
  kind: 'fork' | 'pin' | 'capture';
  text: string;
  squares: string[]; // highlightable squares (actor + targets)
}

function capitalize(s: string): string {
  return s.length ? (s[0]?.toUpperCase() ?? '') + s.slice(1) : s;
}

function pieceLabel(ref: PieceRef): string {
  return `the ${ref.pieceType} on ${ref.square}`;
}

function listPieces(refs: PieceRef[]): string {
  const labels = refs.map(pieceLabel);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0] ?? '';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

function items<T>(collection: { status: string; items?: T[] } | undefined): T[] {
  return collection?.status === 'computed' && Array.isArray(collection.items) ? collection.items : [];
}

function forkIdea(fork: MotifOpportunity): MoveIdea {
  const piece = capitalize(fork.forkingPiece.pieceType);
  const won = fork.targets.filter((t) => t.pieceType !== 'king');
  const squares = [fork.forkingPiece.square, ...fork.targets.map((t) => t.square)];
  if (fork.kingTarget && won.length > 0) {
    // The check wins a tempo; one of the other forked pieces then falls.
    return {
      kind: 'fork',
      squares,
      text: `${piece} checks the king and forks ${listPieces(won)} — the check buys time to win material.`,
    };
  }
  const gain = fork.materialGain >= 100 ? ' — wins material' : '';
  return { kind: 'fork', squares, text: `${piece} forks ${listPieces(fork.targets)}${gain}.` };
}

function pinIdea(pin: PinOpportunity): MoveIdea {
  const immobile = pin.pinnedImmobile ? ' — it cannot move' : ' — it cannot move without loss';
  return {
    kind: 'pin',
    squares: [pin.pinner.square, pin.pinned.square, pin.anchor.square],
    text: `${capitalize(pin.pinner.pieceType)} pins the ${pin.pinned.pieceType} on ${pin.pinned.square} to ${pieceLabel(
      pin.anchor,
    )}${immobile}.`,
  };
}

function captureIdea(cap: CaptureOpportunity): MoveIdea {
  const gain = cap.seeCp >= 100 ? ' and wins material' : '';
  return {
    kind: 'capture',
    squares: [cap.attacker.square, cap.victimSquare],
    text: `Wins ${pieceLabel(cap.victim)}${gain}.`,
  };
}

// Describe the played move's tactical idea, or null if it has no specific one
// (a quiet developing/positional move). Precedence: fork > pin > winning capture.
export function describeMoveIdea(facts: TeachingFactBundleV1): MoveIdea | null {
  const playedUci = facts.played.move.uci;
  const before = facts.before;

  const fork = items<MotifOpportunity>(before.availableMotifs).find((m) => m.moveUci === playedUci);
  if (fork) return forkIdea(fork);

  const pin = items<PinOpportunity>(before.availablePins).find((p) => p.moveUci === playedUci);
  if (pin) return pinIdea(pin);

  // Only a clearly material-winning capture counts as an "idea"; an even trade is
  // just a move, not a teaching point.
  const cap = items<CaptureOpportunity>(before.availableCaptures).find(
    (c) => c.moveUci === playedUci && c.seeCp >= 100,
  );
  if (cap) return captureIdea(cap);

  return null;
}
