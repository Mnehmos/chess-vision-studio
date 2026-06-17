// LED preview grid - renders the active mode's 64-square LedMap as the hardware
// twin would light it (one square, one color).
import type { LedMap } from '../engine/types';
import { ledColorClass } from './led-classes';

export function LedPreview({ ledMap }: { ledMap: LedMap }) {
  const ranks = [7, 6, 5, 4, 3, 2, 1, 0];
  const files = [0, 1, 2, 3, 4, 5, 6, 7];

  return (
    <div className="led-preview">
      <h4 className="led-preview__title">LED preview - {ledMap.mode}</h4>
      <div className="led-preview__grid">
        {ranks.map((r) =>
          files.map((f) => {
            const sq = String.fromCharCode(97 + f) + String.fromCharCode(49 + r);
            const color = ledMap.squares[sq] ?? 'off';
            const className = [
              'led-preview__square',
              ledColorClass(color),
              color === 'off' ? '' : 'is-lit',
              color === 'red_blink' ? 'is-blinking' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return <div key={sq} title={`${sq}: ${color}`} className={className} />;
          }),
        )}
      </div>
    </div>
  );
}
