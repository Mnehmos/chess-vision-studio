import { forwardRef, useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { allSquares } from '../engine/led';
import type { LedColor, LedMap, Square } from '../engine/types';
import {
  isPuzzleSolution,
  type PuzzleStage,
  type TeachingPuzzle as Puzzle,
} from '../engine/teaching/puzzle';
import { Board2D } from './Board2D';

function blankLed(): LedMap {
  const squares: Record<string, LedColor> = {};
  for (const sq of allSquares()) squares[sq] = 'off';
  return { mode: 'puzzle', squares };
}

// Apply a UCI move to a FEN and return the resulting FEN (null if illegal).
function applyUci(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4) || undefined,
    });
    return move ? chess.fen() : null;
  } catch {
    return null;
  }
}

function canonicalDropUci(fen: string, from: Square, to: Square): string | null {
  try {
    const chess = new Chess(fen);
    const candidates = chess.moves({ square: from as never, verbose: true }) as unknown as {
      to: string;
      promotion?: string;
    }[];
    const matching = candidates.filter((move) => move.to === to);
    if (matching.length === 0) return null;
    const selected = matching.find((move) => move.promotion === 'q') ?? matching[0];
    return `${from}${to}${selected.promotion ?? ''}`;
  } catch {
    return null;
  }
}

const TOPIC_LABEL: Record<Puzzle['topicId'], string> = {
  allowed_fork: 'Fork defense',
  allowed_pin: 'Pin defense',
  missed_hanging_piece: 'Winning material',
  failed_defense: 'Threat defense',
  pawn_structure_damage: 'Pawn structure',
  best_move: 'Best move',
};

// Interactive two-stage lesson. The solver drags the solution move on a real
// board (same Board2D + onPieceDrop the analysis view uses); a correct move
// advances the stage. Grading is the pure isPuzzleSolution.
export const TeachingPuzzle = forwardRef<
  HTMLElement,
  {
    puzzle: Puzzle;
    onClose: () => void;
    gradeAlternative?: (stage: PuzzleStage, uci: string) => Promise<boolean>;
  }
>(function TeachingPuzzle({ puzzle, onClose, gradeAlternative }, ref) {
  const [stageIndex, setStageIndex] = useState(0);
  const [status, setStatus] = useState<'solving' | 'checking' | 'wrong' | 'solved'>('solving');
  const [selected, setSelected] = useState<Square | undefined>(undefined);
  // The position AFTER the solved move, so the board shows the completed move
  // instead of snapping the piece back.
  const [resultFen, setResultFen] = useState<string | null>(null);
  const [moved, setMoved] = useState<{ from: Square; to: Square } | null>(null);
  const blank = useMemo(blankLed, []);
  const stage = puzzle.stages[stageIndex];

  useEffect(() => {
    setStageIndex(0);
    setStatus('solving');
    setSelected(undefined);
    setResultFen(null);
    setMoved(null);
  }, [puzzle]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const legalDots = useMemo(() => {
    if (!stage || !selected) return undefined;
    try {
      const chess = new Chess(stage.fen);
      const moves = chess.moves({ square: selected as never, verbose: true }) as unknown as {
        to: string;
      }[];
      return moves.length ? (moves.map((move) => move.to) as Square[]) : undefined;
    } catch {
      return undefined;
    }
  }, [stage, selected]);

  if (!stage) {
    return (
      <section ref={ref} data-testid="teaching-puzzle" className="teaching-puzzle">
        <Header title="Lesson complete" onClose={onClose} />
        <div className="teaching-puzzle__success">
          {'\u2713'} Solved {'\u2014'} nice work.
        </div>
      </section>
    );
  }

  const onDrop = async (from: Square, to: Square) => {
    if (status === 'checking' || status === 'solved') return;
    const uci = canonicalDropUci(stage.fen, from, to);
    if (!uci) {
      setStatus('wrong');
      return;
    }

    let solved = isPuzzleSolution(stage, uci);
    if (!solved && stage.kind === 'prevention' && gradeAlternative) {
      setStatus('checking');
      try {
        solved = await gradeAlternative(stage, uci);
      } catch {
        solved = false;
      }
    }

    if (solved) {
      const after = applyUci(stage.fen, uci);
      const fromSq = uci.slice(0, 2) as Square;
      const toSq = uci.slice(2, 4) as Square;
      setResultFen(after ?? null);
      setMoved({ from: fromSq, to: toSq });
      setStatus('solved');
      setSelected(undefined);
    } else {
      setStatus('wrong');
      setSelected(undefined);
    }
  };

  const onSquareSelect = (square: Square) => {
    if (!stage || status === 'checking' || status === 'solved') return;
    if (selected) {
      if (selected === square) {
        setSelected(undefined);
        return;
      }
      if (canonicalDropUci(stage.fen, selected, square)) {
        void onDrop(selected, square);
        return;
      }
    }

    try {
      const chess = new Chess(stage.fen);
      const piece = chess.get(square as never);
      const expectedColor = stage.sideToMove === 'white' ? 'w' : 'b';
      const hasLegalMove = chess.moves({ square: square as never }).length > 0;
      setSelected(piece?.color === expectedColor && hasLegalMove ? square : undefined);
    } catch {
      setSelected(undefined);
    }
  };

  const goNext = () => {
    setStageIndex((index) => index + 1);
    setStatus('solving');
    setSelected(undefined);
    setResultFen(null);
    setMoved(null);
  };

  const resetStage = () => {
    setStatus('solving');
    setSelected(undefined);
    setResultFen(null);
    setMoved(null);
  };

  const showHint = () => {
    if (!stage || status === 'checking' || status === 'solved') return;
    setSelected(stage.solutionUci.slice(0, 2) as Square);
    setStatus('solving');
  };

  // Once solved, light the completed move (origin blue, destination green); else the
  // blank board so legal dots read cleanly.
  const ledMap =
    status === 'solved' && moved
      ? {
          mode: 'puzzle',
          squares: { ...blank.squares, [moved.from]: 'blue' as const, [moved.to]: 'green' as const },
        }
      : blank;
  const boardFen = status === 'solved' && resultFen ? resultFen : stage.fen;
  const lastStage = stageIndex + 1 >= puzzle.stages.length;

  return (
    <section ref={ref} data-testid="teaching-puzzle" className="teaching-puzzle">
      <Header
        title={TOPIC_LABEL[puzzle.topicId]}
        progress={`${stageIndex + 1}/${puzzle.stages.length}`}
        onClose={onClose}
      />
      <div className="teaching-puzzle__context">
        <span className={`teaching-puzzle__turn is-${stage.sideToMove}`}>
          <span className="teaching-puzzle__turn-piece">
            {stage.sideToMove === 'white' ? '\u2654' : '\u265A'}
          </span>
          {stage.sideToMove === 'white' ? 'White' : 'Black'} to move
        </span>
        <span className="teaching-puzzle__kind">
          {stage.kind === 'punishment' ? 'Find the tactic' : 'Improve the move'}
        </span>
      </div>
      <div className="teaching-puzzle__prompt">{stage.prompt}</div>
      <div className="teaching-puzzle__instruction">
        Drag a piece, or select it and then choose its destination.
      </div>
      <div className="teaching-puzzle__board">
        <Board2D
          fen={boardFen}
          ledMap={ledMap}
          selected={status === 'solved' || status === 'checking' ? undefined : selected}
          legalDots={status === 'solved' || status === 'checking' ? undefined : legalDots}
          onSelect={onSquareSelect}
          orientation={stage.sideToMove}
          draggable={status === 'solving' || status === 'wrong'}
          onPieceDrop={onDrop}
          squareSizeCss="clamp(28px, calc((100cqw - 4px) / 8), 42px)"
        />
      </div>
      <div className="teaching-puzzle__status" aria-live="polite">
        {status === 'solving' && (
          <span className="teaching-puzzle__status-muted">
            {selected ? `Selected ${selected}. Choose a legal square.` : 'Your move.'}
          </span>
        )}
        {status === 'checking' && (
          <span className="teaching-puzzle__status-muted">Checking alternative...</span>
        )}
        {status === 'wrong' && (
          <span className="teaching-puzzle__status-bad">
            Not quite {'\u2014'} try again.
          </span>
        )}
        {status === 'solved' && (
          <span className="teaching-puzzle__success">{'\u2713'} Correct!</span>
        )}
        {status === 'solved' &&
          (lastStage ? (
            <button type="button" className="teaching-puzzle__next" onClick={onClose}>
              Done
            </button>
          ) : (
            <button type="button" className="teaching-puzzle__next" onClick={goNext}>
              Next stage {'\u2192'}
            </button>
          ))}
      </div>
      {status !== 'solved' && status !== 'checking' && (
        <div className="teaching-puzzle__actions">
          <button type="button" className="teaching-puzzle__secondary" onClick={showHint}>
            Hint
          </button>
          {(selected || status === 'wrong') && (
            <button type="button" className="teaching-puzzle__secondary" onClick={resetStage}>
              Reset
            </button>
          )}
        </div>
      )}
    </section>
  );
});

function Header({
  title,
  progress,
  onClose,
}: {
  title: string;
  progress?: string;
  onClose: () => void;
}) {
  return (
    <div className="teaching-puzzle__header">
      <span className="teaching-puzzle__title">{title}</span>
      {progress && <span className="teaching-puzzle__progress">Stage {progress}</span>}
      <button
        type="button"
        className="teaching-puzzle__close"
        onClick={onClose}
        aria-label="Close puzzle"
        title="Close puzzle"
      >
        {'\u2715'}
      </button>
    </div>
  );
}
