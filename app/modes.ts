// Mode registry — each mode owns its color language (Invariant 6). The legend
// is the human-readable key shown beside the board.
import type { ModeId } from '../engine/led';
import type { LedColor } from '../engine/types';

export interface ModeDef {
  id: ModeId;
  label: string;
  needsAnalysis?: boolean; // 'what_changed' needs a computed MoveAnalysis
  legend: { color: LedColor; meaning: string }[];
}

export const MODES: ModeDef[] = [
  {
    id: 'legal',
    label: 'Legal Move',
    legend: [
      { color: 'green', meaning: 'quiet move' },
      { color: 'red', meaning: 'capture' },
      { color: 'yellow', meaning: 'gives check' },
      { color: 'purple', meaning: 'tactical candidate' },
    ],
  },
  {
    id: 'threat',
    label: 'Threat Map',
    legend: [
      { color: 'blue', meaning: 'White controls' },
      { color: 'orange', meaning: 'Black controls' },
      { color: 'purple', meaning: 'contested' },
      { color: 'dark_red', meaning: 'king danger' },
    ],
  },
  {
    id: 'defense',
    label: 'Defense Map',
    legend: [
      { color: 'blue', meaning: 'White defended' },
      { color: 'yellow', meaning: 'White loose' },
      { color: 'green', meaning: 'Black defended' },
      { color: 'orange', meaning: 'Black loose' },
    ],
  },
  {
    id: 'hanging',
    label: 'Hanging (SEE)',
    legend: [
      { color: 'yellow', meaning: 'loose but SEE ≥ 0' },
      { color: 'orange', meaning: 'attacked & fragile' },
      { color: 'red', meaning: 'SEE-losing' },
      { color: 'red_blink', meaning: 'queen / mate-level loss' },
    ],
  },
  {
    id: 'what_changed',
    label: 'What Changed',
    needsAnalysis: true,
    legend: [
      { color: 'green', meaning: 'newly defended' },
      { color: 'red', meaning: 'newly attacked / losing' },
      { color: 'yellow', meaning: 'newly loose' },
      { color: 'orange', meaning: 'new opportunity' },
      { color: 'gray', meaning: 'relationship removed' },
    ],
  },
  {
    id: 'pawn',
    label: 'Pawn Structure',
    legend: [
      { color: 'green', meaning: 'passed' },
      { color: 'red', meaning: 'isolated' },
      { color: 'yellow', meaning: 'doubled' },
      { color: 'blue', meaning: 'healthy / chain' },
    ],
  },
  {
    id: 'tactics',
    label: 'Tactics (Motif)',
    legend: [
      { color: 'purple', meaning: 'executing piece' },
      { color: 'orange', meaning: 'target' },
      { color: 'gray', meaning: 'forcing-line square' },
    ],
  },
];

export const LED_CSS: Record<LedColor, string> = {
  green: '#3fbf5f',
  red: '#e23b3b',
  blue: '#3b7fe2',
  yellow: '#e8d23b',
  orange: '#e8923b',
  purple: '#a14fe0',
  dark_red: '#7a1010',
  gray: '#8a8a8a',
  red_blink: '#ff2a2a',
  off: 'transparent',
};
