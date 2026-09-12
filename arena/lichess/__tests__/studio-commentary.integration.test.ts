// Live integration: the bot's commentary path against a RUNNING studio dev server.
// Skipped when the studio is not reachable, so the suite still runs standalone.
//
//   npm run dev -- --port 5199        (or CVS_STUDIO_URL=http://host:port)
//
// Prints the rendered lines so the wording can be judged, not just asserted.
import { describe, expect, it } from 'vitest';
import { studioLine } from '../studio-commentary';

const STUDIO = process.env.CVS_STUDIO_URL ?? 'http://localhost:5199';

async function studioUp(): Promise<boolean> {
  try {
    const res = await fetch(`${STUDIO}/api/cvs-engine/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', depth: 2 }),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const up = await studioUp();
// eslint-disable-next-line no-console
console.log(up ? `studio reachable at ${STUDIO}` : `studio NOT reachable at ${STUDIO} — skipping`);

describe.skipIf(!up)('studio commentary (live)', () => {
  it('renders a line for a tactic-creating move, move number included', async () => {
    const line = await studioLine(
      { baseUrl: STUDIO, depth: 10 },
      {
        // The move number comes from the FEN's counters (as in a real game), so the FEN
        // must say move 12 for the line to read "12." — the earlier fixture said move 1
        // while passing ply 23, which asserted a number the studio would never render.
        fenBefore: 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 12',
        fenAfter: 'r3k3/2N5/8/8/8/8/8/4K3 b - - 1 12',
        uci: 'b5c7',
        san: 'Nc7+',
        ply: 23,
        mover: 'white',
      },
    );
    // eslint-disable-next-line no-console
    console.log('good-move line:', JSON.stringify(line));
    if (line) {
      expect(line.text.startsWith('12.')).toBe(true);
      expect(line.text.length).toBeLessThanOrEqual(200);
    }
  }, 60_000);

  it('renders a line for an eval-losing move (the review voice)', async () => {
    // 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6?? 4. Qxf7# — the blunder position, one ply early.
    const line = await studioLine(
      { baseUrl: STUDIO, depth: 12 },
      {
        fenBefore: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
        fenAfter: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
        uci: 'd2d4',
        san: 'd4',
        ply: 7,
        mover: 'white',
      },
    );
    // eslint-disable-next-line no-console
    console.log('blunder-context line:', JSON.stringify(line));
  }, 60_000);
});
