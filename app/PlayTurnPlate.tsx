export function PlayTurnPlate({ color, active }: { color: 'w' | 'b'; active: boolean }) {
  const sideName = color === 'w' ? 'White' : 'Black';
  return (
    <div
      data-testid={`turn-${color}`}
      className={`play-turn-plate${active ? ' is-active' : ''}`}
    >
      <span
        className={`play-turn-plate__disc play-turn-plate__disc--${color === 'w' ? 'white' : 'black'}`}
      />
      <strong className="play-turn-plate__label">{sideName}</strong>
      {active && <span className="play-turn-plate__active">{'\u25cf'} to move</span>}
    </div>
  );
}
