import { useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { allSquares } from '../engine/led';
import type { LedColor, LedMap, Square } from '../engine/types';
import { isPuzzleSolution, type TeachingPuzzle as Puzzle } from '../engine/teaching/puzzle';
import { Board2D } from './Board2D';

const CARD: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--accent)',
  borderRadius: 10,
  padding: 12,
};

function blankLed(): LedMap {
  const squares: Record<string, LedColor> = {};
  for (const sq of allSquares()) squares[sq] = 'off';
  return { mode: 'puzzle', squares };
}

// Interactive two-stage lesson. The solver drags the solution move on a real
// board (same Board2D + onPieceDrop the analysis view uses); a correct move
// advances the stage. Grading is the pure isPuzzleSolution.
export function TeachingPuzzle({ puzzle, onClose }: { puzzle: Puzzle; onClose: () => void }) {
  const [stageIndex, setStageIndex] = useState(0);
  const [status, setStatus] = useState<'solving' | 'wrong' | 'solved'>('solving');
  const [selected, setSelected] = useState<Square | undefined>(undefined);
  const ledMap = useMemo(blankLed, []);
  const stage = puzzle.stages[stageIndex];

  const legalDots = useMemo(() => {
    if (!stage || !selected) return undefined;
    try {
      const c = new Chess(stage.fen);
      const moves = c.moves({ square: selected as never, verbose: true }) as unknown as {
        to: string;
      }[];
      return moves.length ? (moves.map((m) => m.to) as Square[]) : undefined;
    } catch {
      return undefined;
    }
  }, [stage, selected]);

  if (!stage) {
    return (
      <section data-testid="teaching-puzzle" style={CARD}>
        <Header title="Lesson complete" onClose={onClose} />
        <div style={{ color: '#3fbf5f', fontSize: 13 }}>✓ Solved — nice work.</div>
      </section>
    );
  }

  const onDrop = (from: Square, to: Square) => {
    if (isPuzzleSolution(stage, `${from}${to}`)) {
      setStatus('solved');
      setSelected(undefined);
    } else {
      setStatus('wrong');
    }
  };

  const lastStage = stageIndex + 1 >= puzzle.stages.length;

  return (
    <section data-testid="teaching-puzzle" style={CARD}>
      <Header title={`Puzzle · stage ${stageIndex + 1}/${puzzle.stages.length}`} onClose={onClose} />
      <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 8 }}>{stage.prompt}</div>
      <Board2D
        fen={stage.fen}
        ledMap={ledMap}
        selected={selected}
        legalDots={legalDots}
        onSelect={(sq) => setSelected((cur) => (cur === sq ? undefined : sq))}
        orientation={stage.sideToMove}
        draggable
        onPieceDrop={onDrop}
      />
      <div style={{ marginTop: 8, fontSize: 13, minHeight: 22, display: 'flex', gap: 8, alignItems: 'center' }}>
        {status === 'wrong' && <span style={{ color: 'var(--bad)' }}>Not quite — try again.</span>}
        {status === 'solved' && <span style={{ color: '#3fbf5f' }}>✓ Correct!</span>}
        {status === 'solved' &&
          (lastStage ? (
            <span style={{ color: 'var(--muted)' }}>Lesson complete.</span>
          ) : (
            <button
              onClick={() => {
                setStageIndex((i) => i + 1);
                setStatus('solving');
              }}
              style={btn}
            >
              Next →
            </button>
          ))}
      </div>
    </section>
  );
}

const btn: React.CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--accent)',
  color: '#fff',
  borderRadius: 6,
  padding: '3px 10px',
  fontSize: 12,
  cursor: 'pointer',
};

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
      <span
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 10,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: 'var(--accent-light)',
        }}
      >
        {title}
      </span>
      <button
        onClick={onClose}
        aria-label="Close puzzle"
        style={{
          marginLeft: 'auto',
          border: '1px solid var(--border)',
          background: 'var(--card)',
          color: 'var(--text)',
          borderRadius: 6,
          padding: '2px 8px',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        ✕
      </button>
    </div>
  );
}
