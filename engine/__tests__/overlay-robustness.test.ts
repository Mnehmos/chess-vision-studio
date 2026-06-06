import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pliesFromPgn } from '../position';
import { computeLedMap, type ModeId } from '../led';
import { detectAvailableMotifs } from '../motif';
import { squareReport } from '../relationship';
import { selectionArrows } from '../../app/annotate';

describe('crash probe — pure overlays across every ply', () => {
  it('runs every pure function on every ply without throwing', () => {
    const pgn = readFileSync(join(__dirname, '../../fixtures/sample-game.pgn'), 'utf8');
    const plies = pliesFromPgn(pgn);
    const modes: ModeId[] = ['legal', 'threat', 'defense', 'hanging', 'pawn', 'tactics'];
    const errors: string[] = [];
    for (const p of plies) {
      const fen = p.fenAfter;
      const sel = p.to;
      const stage = (name: string, fn: () => void) => {
        try {
          fn();
        } catch (e) {
          errors.push(`ply ${p.ply} (${p.san}) @ ${name}: ${(e as Error).message}`);
        }
      };
      for (const m of modes) stage(`led:${m}`, () => computeLedMap(m, { fen, selectedSquare: sel }));
      stage('detectMotifs', () => detectAvailableMotifs(fen));
      stage('squareReport', () => squareReport(fen, sel));
      stage('selectionArrows', () => selectionArrows(fen, sel, true));
    }
    if (errors.length) console.log('CRASHES:\n' + errors.join('\n'));
    if (errors.length) throw new Error(`${errors.length} crash(es) found`);
  });
});
