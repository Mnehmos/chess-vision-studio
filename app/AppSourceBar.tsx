import { useState } from 'react';
import type { ParsedGame } from '../engine/position';

type AppTab = 'board' | 'dataset' | 'play';

export function AppSourceBar({
  games,
  gameIndex,
  onSelectGame,
  tab,
  pgnText,
  setPgnText,
  onLoad,
}: {
  games: ParsedGame[];
  gameIndex: number;
  onSelectGame: (index: number) => void;
  tab: AppTab;
  pgnText: string;
  setPgnText: (pgn: string) => void;
  onLoad: () => void;
}) {
  const [open, setOpen] = useState(false);
  const multi = games.length > 1;
  const loadedLabel = multi
    ? `${games.length} games loaded`
    : (games[gameIndex]?.label ?? 'Sample game');

  return (
    <section className="app-source-bar">
      <div className="app-source-bar__summary">
        <button className="app-source-bar__import" onClick={() => setOpen((value) => !value)}>
          {'\u2b06'} Import PGN
        </button>
        <div className="app-source-bar__label">
          <strong className="app-source-bar__loaded">{loadedLabel}</strong>
          <span className="app-source-bar__hint">
            {' '}
            {'\u00b7'} paste your Chess.com / Lichess export to analyze your own games
          </span>
        </div>
        <div className="app-source-bar__selector">
          {multi && tab === 'board' && (
            <select
              className="app-source-bar__game-select"
              value={gameIndex}
              onChange={(event) => onSelectGame(Number(event.target.value))}
            >
              {games.map((game, index) => (
                <option key={index} value={index}>
                  {game.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {open && (
        <div className="app-source-bar__import-panel">
          <textarea
            className="app-source-bar__textarea"
            value={pgnText}
            onChange={(event) => setPgnText(event.target.value)}
            placeholder="Paste a PGN - one game or a multi-game export (Chess.com / Lichess / OpeningTree)..."
          />
          <div className="app-source-bar__actions">
            <button
              className="app-source-bar__load"
              onClick={() => {
                onLoad();
                setOpen(false);
              }}
            >
              Load games
            </button>
            <span className="app-source-bar__note">
              Multi-game exports open a Dataset view: opening tree, results over time,
              per-game review.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
