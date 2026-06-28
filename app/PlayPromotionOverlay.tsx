import type { Square } from '../engine/types';
import { pieceSvg, pieceLabel } from './piece-set';

const PROMO_PIECES = ['q', 'r', 'n', 'b'] as const;

export function PlayPromotionOverlay({
  promo,
  turn,
  onPromote,
}: {
  promo: { from: Square; to: Square } | null;
  turn: 'w' | 'b';
  onPromote: (piece: (typeof PROMO_PIECES)[number]) => void;
}) {
  if (!promo) return null;

  return (
    <div className="play-promotion-overlay">
      <div className="play-promotion-overlay__panel">
        <span className="play-promotion-overlay__label">Promote to</span>
        {PROMO_PIECES.map((piece) => (
          <button
            key={piece}
            aria-label={`promote-${piece}`}
            onClick={() => onPromote(piece)}
            className="play-promotion-overlay__piece"
          >
            <img src={pieceSvg(turn, piece)} alt={pieceLabel(turn, piece)} />
          </button>
        ))}
      </div>
    </div>
  );
}
