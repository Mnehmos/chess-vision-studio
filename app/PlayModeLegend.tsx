import type { ModeId } from '../engine/led';
import { ledColorClass } from './led-classes';
import { MODES } from './modes';

export function PlayModeLegend({ mode }: { mode: ModeId }) {
  const legend = MODES.find((m) => m.id === mode)?.legend ?? [];
  if (legend.length === 0) return null;

  return (
    <div className="play-mode-legend">
      {legend.map((item) => (
        <span key={item.color + item.meaning} className="play-mode-legend__item">
          <span className={`play-mode-legend__swatch ${ledColorClass(item.color)}`} />
          {item.meaning}
        </span>
      ))}
    </div>
  );
}
