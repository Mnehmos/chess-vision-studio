// SVG arrow annotator overlaid on the board. Visualizes two things:
//   • a selected piece's DEFENDERS (friendly) and ATTACKERS (adversary)
//   • a call-and-response THREAT LINE (numbered, colored by the moving side)
import type { Square } from '../engine/types';

export interface Arrow {
  from: Square;
  to: Square;
  color: string;
  label?: string; // sequence number for threat lines
  dashed?: boolean;
  move?: boolean; // the played move — subtle slate, thin, small arrowhead
  dim?: boolean; // de-emphasized (focus mode)
}

// The app's visual grammar (consistent everywhere):
//   red    = attacks / threats / captures (incoming AND the selected piece's own)
//   green  = defenders / protection
//   orange = tactical candidate / threat line (numbered for call-and-response)
//   slate  = the move that was just PLAYED (so "moved here" never reads as "attacks here")
export const ARROW = {
  defend: '#2f855a', // green
  attack: '#c53030', // red
  tactical: '#dd6b20', // orange
  move: '#4a5568', // slate — the played move
};

const CELL = 56;
const SIZE = CELL * 8;

function center(sq: Square, orientation: 'white' | 'black'): { x: number; y: number } {
  const f = sq.charCodeAt(0) - 97;
  const r = sq.charCodeAt(1) - 49;
  const col = orientation === 'white' ? f : 7 - f;
  const row = orientation === 'white' ? 7 - r : r;
  return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 };
}

export function BoardArrows({ arrows, orientation = 'white' }: { arrows: Arrow[]; orientation?: 'white' | 'black' }) {
  const colors = Array.from(new Set(arrows.map((a) => a.color)));
  return (
    <svg
      width={SIZE}
      height={SIZE}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
    >
      <defs>
        {colors.map((c) => (
          <marker
            key={c}
            id={`ah-${c.replace('#', '')}`}
            markerWidth="6"
            markerHeight="6"
            refX="4.5"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill={c} />
          </marker>
        ))}
        {colors.map((c) => (
          <marker
            key={`s-${c}`}
            id={`ahs-${c.replace('#', '')}`}
            markerWidth="4"
            markerHeight="4"
            refX="3"
            refY="2"
            orient="auto"
          >
            <path d="M0,0 L4,2 L0,4 Z" fill={c} />
          </marker>
        ))}
      </defs>
      {arrows.map((a, i) => {
        const A = center(a.from, orientation);
        const B = center(a.to, orientation);
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        // start a bit off the source center; stop short of the target center
        const x1 = A.x + ux * 16;
        const y1 = A.y + uy * 16;
        const x2 = B.x - ux * 20;
        const y2 = B.y - uy * 20;
        return (
          <g key={i}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={a.color}
              strokeWidth={a.move ? 3 : 4}
              strokeOpacity={a.dim ? 0.18 : a.move ? 0.5 : 0.85}
              strokeLinecap="round"
              strokeDasharray={a.dashed ? '6 5' : undefined}
              markerEnd={`url(#ah${a.move ? 's' : ''}-${a.color.replace('#', '')})`}
            />
            {a.label && (
              <>
                <circle cx={x1} cy={y1} r={8} fill={a.color} />
                <text
                  x={x1}
                  y={y1 + 3.5}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="700"
                  fill="#fff"
                >
                  {a.label}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
