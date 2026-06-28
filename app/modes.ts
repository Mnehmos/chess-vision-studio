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
      { color: 'red', meaning: 'Black controls' },
      { color: 'purple', meaning: 'contested' },
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
      { color: 'yellow', meaning: 'attacked, adequately defended' },
      { color: 'orange', meaning: 'pressured — more attackers than defenders' },
      { color: 'blue', meaning: 'White advantage — +pts won (piece taken, or square if Black contests)' },
      { color: 'red', meaning: 'Black advantage — +pts won (piece taken, or square if White contests)' },
      { color: 'purple', meaning: 'contested empty sq — standoff (shared, or neither can hold it)' },
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

// Warm, slightly desaturated palette tuned to sit on the stone board without the
// neon glare the old saturated colours had. Hues track the Mnehmos status colours
// (success / danger / info) plus copper/slate/contested for the control maps.
export const LED_CSS: Record<LedColor, string> = {
  green: '#5fa05f',
  red: '#cc5a4d',
  blue: '#5b8fc7',
  yellow: '#e3b341',
  orange: '#d98a3d',
  purple: '#9662a8',
  dark_red: '#7a1010',
  dark_blue: '#16306b',
  gray: '#8a817a',
  red_blink: '#e2483b',
  off: 'transparent',
};
