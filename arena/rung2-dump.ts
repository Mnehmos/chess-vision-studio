// Rung-2 feature dump/debug. Prints every Rung-2 value feature (White-POV signed)
// for a FEN so the inert feature pack can be eyeballed and validated before it is
// ever trained or wired live. Usage:
//   npm run rung2:dump -- --fen "rnbq.../... w KQkq - 0 1"
import { Chess } from 'chess.js';
import { extractRung2Features, RUNG2_KEYS } from '@cvs/engine';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function dumpFen(fen: string, log: (m: string) => void = (m) => console.log(m)): void {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    log(`invalid FEN: ${fen}`);
    return;
  }
  const feats = extractRung2Features(chess);
  log(`Rung-2 features (White-POV signed; + favors White) for:`);
  log(`  ${fen}`);
  for (const k of RUNG2_KEYS) log(`  ${k.padEnd(20)} ${feats[k].toFixed(3)}`);
}

function parseArgs(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fen') return argv[i + 1] ?? START;
  }
  return START;
}

if (!process.env.VITEST) {
  dumpFen(parseArgs(process.argv.slice(2)));
}
