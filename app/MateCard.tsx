// Mate-line card — shown under the facts panel when a forced mate is in play.
// The oracle (Stockfish) says mate exists; the evaluator (mateproof.ts) explains
// it in OBLIGATION terms: the forcing line, the critical attacker + checking line,
// the support piece, and the king's collapsing escape squares.
import type { MateProof } from '../engine/types';

export function MateCard({ proof, fen }: { proof: MateProof; fen: string }) {
  const moveNo = parseInt(fen.trim().split(/\s+/)[5] ?? '1', 10);
  const matingIsWhite = proof.matingSide === 'white';

  return (
    <div
      style={{
        marginTop: 12,
        border: '1px solid rgba(210, 60, 60, 0.4)',
        borderLeft: '3px solid #d43b3b',
        borderRadius: 8,
        padding: '10px 12px',
        background: 'var(--card2, #1f1f1f)',
        minWidth: 300,
        fontSize: 14,
        color: 'var(--text, #e8e0d8)',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6, color: '#e0635e' }}>
        Forced mate — mate in {proof.mateInMoves}
      </div>
      <div style={{ fontFamily: 'ui-monospace, monospace', marginBottom: 8, color: 'var(--text-soft, #b0a898)', fontSize: 13 }}>
        {formatLine(proof.line, moveNo, matingIsWhite)}
      </div>
      <Obligation label="Critical attacker" value={`${proof.matingPiece} (checks via ${proof.checkingLine})`} />
      {proof.supportPiece && <Obligation label="Support piece" value={proof.supportPiece} />}
      <Obligation
        label="King escape squares"
        value={proof.kingEscapesAtStart === 0 ? 'none' : `${proof.kingEscapesAtStart} (shrinking)`}
      />
      <Obligation label="Trapped king" value={proof.trappedKing} />
    </div>
  );
}

function Obligation({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ lineHeight: 1.5, fontSize: 13 }}>
      <span style={{ color: 'var(--muted, #888)' }}>{label}:</span>{' '}
      <span style={{ color: 'var(--text-soft, #b0a898)' }}>{value}</span>
    </div>
  );
}

/** "29. Re8+ Kf7 30. Rfe1 Rxg4 31. R1e7#" — number the mating side's moves. */
function formatLine(line: string[], startNo: number, matingIsWhite: boolean): string {
  const out: string[] = [];
  let no = startNo;
  let whiteToMove = matingIsWhite;
  for (let i = 0; i < line.length; i++) {
    if (whiteToMove) out.push(`${no}. ${line[i]}`);
    else {
      out.push(line[i]);
      no++;
    }
    whiteToMove = !whiteToMove;
  }
  // If Black mates first, prefix the opening ellipsis numbering.
  if (!matingIsWhite && out.length) out[0] = `${startNo}... ${line[0]}`;
  return out.join(' ');
}
