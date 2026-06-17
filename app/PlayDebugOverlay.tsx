import type { TeachingNode } from '../engine/teaching/node';
import type { InsightCandidate, MoveAnalysis, Square } from '../engine/types';

export function PlayDebugOverlay({
  ply,
  turn,
  selected,
  focused,
  fen,
  lastAnalysis,
  liveAnalysis,
  teachingNodes,
}: {
  ply: number;
  turn: 'w' | 'b';
  selected: Square | null;
  focused: InsightCandidate | null;
  fen: string;
  lastAnalysis: MoveAnalysis | null;
  liveAnalysis: MoveAnalysis | null;
  teachingNodes: TeachingNode[];
}) {
  const empty = '\u2014';
  const middleDot = '\u00b7';

  return (
    <div data-testid="debug-overlay" className="play-debug-overlay">
      <strong className="play-debug-overlay__title">debug</strong>
      <div>
        ply: {ply} {middleDot} sideToMove: {turn}
      </div>
      <div>
        selected: {selected ?? empty} {middleDot} focused:{' '}
        {focused ? focused.squares.join(',') : empty}
      </div>
      <div>fen: {fen}</div>
      <div>analysis.positionId: {lastAnalysis?.positionId ?? empty}</div>
      <div>
        positionAfter===fen:{' '}
        {lastAnalysis ? String(lastAnalysis.positionAfter === fen) : empty} {middleDot} live:{' '}
        {liveAnalysis ? 'yes' : 'no'}
      </div>
      <div>
        class: {lastAnalysis?.classification ?? empty} {middleDot} cpLoss:{' '}
        {lastAnalysis ? lastAnalysis.cpLoss.toFixed(2) : empty}
      </div>
      <div>
        evalBefore: {lastAnalysis?.evalBefore.status ?? (lastAnalysis ? 'ok' : empty)}
        {lastAnalysis?.evalBefore.reason ? ` (${lastAnalysis.evalBefore.reason})` : ''}{' '}
        {middleDot} evalAfter:{' '}
        {lastAnalysis?.evalAfter.status ?? (lastAnalysis ? 'ok' : empty)}
        {lastAnalysis?.evalAfter.reason ? ` (${lastAnalysis.evalAfter.reason})` : ''}
      </div>
      <div>teaching events: {teachingNodes.length}</div>
    </div>
  );
}
