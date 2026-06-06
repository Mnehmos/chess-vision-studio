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
}

// One coherent scheme used across the app.
export const ARROW = {
  defend: '#2f855a', // friendly — green
  attack: '#c53030', // adversary — red
  white: '#2b6cb0', // White's move — blue
  black: '#dd6b20', // Black's move — orange
};

const CELL = 56;
const SIZE = CELL * 8;

function center(sq: Square): { x: number; y: number } {
  const f = sq.charCodeAt(0) - 97;
  const r = sq.charCodeAt(1) - 49;
  return { x: f * CELL + CELL / 2, y: (7 - r) * CELL + CELL / 2 };
}

export function BoardArrows({ arrows }: { arrows: Arrow[] }) {
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
      </defs>
      {arrows.map((a, i) => {
        const A = center(a.from);
        const B = center(a.to);
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
              strokeWidth={4}
              strokeOpacity={0.85}
              strokeLinecap="round"
              strokeDasharray={a.dashed ? '6 5' : undefined}
              markerEnd={`url(#ah-${a.color.replace('#', '')})`}
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
