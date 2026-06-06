// LED preview grid — renders the active mode's 64-square LedMap as the hardware
// twin would light it (one square, one color).
import type { LedMap } from '../engine/types';
import { LED_CSS } from './modes';

export function LedPreview({ ledMap }: { ledMap: LedMap }) {
  const ranks = [7, 6, 5, 4, 3, 2, 1, 0];
  const files = [0, 1, 2, 3, 4, 5, 6, 7];
  return (
    <div>
      <h4 style={{ margin: '0 0 6px' }}>LED preview · {ledMap.mode}</h4>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 20px)',
          gridTemplateRows: 'repeat(8, 20px)',
          gap: 2,
          background: '#111',
          padding: 4,
          borderRadius: 4,
          width: 'max-content',
        }}
      >
        {ranks.map((r) =>
          files.map((f) => {
            const sq = String.fromCharCode(97 + f) + String.fromCharCode(49 + r);
            const color = ledMap.squares[sq] ?? 'off';
            return (
              <div
                key={sq}
                title={`${sq}: ${color}`}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 3,
                  background: color === 'off' ? '#222' : LED_CSS[color],
                  boxShadow: color === 'off' ? undefined : `0 0 6px ${LED_CSS[color]}`,
                  animation:
                    color === 'red_blink' ? 'csvBlink 0.8s steps(2, start) infinite' : undefined,
                }}
              />
            );
          }),
        )}
      </div>
    </div>
  );
}
