import type { PlayOpponent } from './play-mode-export';
import type { PlaySide } from './play-mode-state';

const OPPONENTS: PlayOpponent[] = ['none', 'cvs', 'stockfish'];

function opponentLabel(opponent: PlayOpponent): string {
  if (opponent === 'none') return 'Off (both sides)';
  if (opponent === 'cvs') return 'CVS';
  return 'Stockfish';
}

export function PlayOpponentControls({
  opponent,
  cvsAvailable,
  stockfishAvailable,
  playerSide,
  thinking,
  onOpponentChange,
  onPlayerSideChange,
}: {
  opponent: PlayOpponent;
  cvsAvailable: boolean;
  stockfishAvailable: boolean;
  playerSide: PlaySide;
  thinking: boolean;
  onOpponentChange: (opponent: PlayOpponent) => void;
  onPlayerSideChange: (side: PlaySide) => void;
}) {
  return (
    <div className="play-control-row">
      <span className="play-control-label">Opponent</span>
      {OPPONENTS.map((candidate) => {
        const disabled =
          candidate === 'cvs' ? !cvsAvailable : candidate === 'stockfish' ? !stockfishAvailable : false;
        return (
          <button
            key={candidate}
            data-testid={`opponent-${candidate}`}
            disabled={disabled}
            onClick={() => onOpponentChange(candidate)}
            title={
              disabled
                ? candidate === 'cvs'
                  ? 'Rust engine unavailable'
                  : 'Stockfish not loaded'
                : undefined
            }
            className={`play-mode-button${candidate === opponent ? ' is-active' : ''}`}
          >
            {opponentLabel(candidate)}
          </button>
        );
      })}
      {opponent !== 'none' && (
        <>
          <span className="play-control-label play-control-label--side">You play</span>
          {(['w', 'b'] as const).map((side) => (
            <button
              key={side}
              onClick={() => onPlayerSideChange(side)}
              className={`play-mode-button${side === playerSide ? ' is-active' : ''}`}
            >
              {side === 'w' ? 'White' : 'Black'}
            </button>
          ))}
          {thinking && (
            <span data-testid="opponent-thinking" className="play-opponent-thinking">
              Engine thinking{'\u2026'}
            </span>
          )}
        </>
      )}
    </div>
  );
}
