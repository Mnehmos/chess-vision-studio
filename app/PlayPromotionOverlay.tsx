import type { Square } from '../engine/types';

const PROMO_PIECES = ['q', 'r', 'n', 'b'] as const;
const PROMO_GLYPH: Record<'w' | 'b', Record<(typeof PROMO_PIECES)[number], string>> = {
  w: { q: '\u2655', r: '\u2656', n: '\u2658', b: '\u2657' },
  b: { q: '\u265b', r: '\u265c', n: '\u265e', b: '\u265d' },
};

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
            {PROMO_GLYPH[turn][piece]}
          </button>
        ))}
      </div>
    </div>
  );
}
