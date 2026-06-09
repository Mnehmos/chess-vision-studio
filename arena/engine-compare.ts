// engine:compare — run the same position through multiple backends side by side.
//
//   npm run engine:compare -- --fen "<fen>" --depth 4 --backends ts,rust
import { Chess } from 'chess.js';
import { createEngineBackend, type MoveResult } from './engine-backend';

function parseArgs(argv: string[]): { fen: string; depth: number; backends: string[] } {
  let fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let depth = 4;
  let backends = ['ts', 'rust'];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fen') fen = argv[++i] ?? fen;
    else if (argv[i] === '--depth') depth = Number(argv[++i]) || depth;
    else if (argv[i] === '--backends') backends = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  }
  return { fen, depth, backends };
}

function san(fen: string, uci: string | null): string {
  if (!uci) return '(none)';
  try {
    const c = new Chess(fen);
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    return m?.san ?? uci;
  } catch {
    return uci;
  }
}

async function main(): Promise<void> {
  const { fen, depth, backends } = parseArgs(process.argv.slice(2));
  console.log(`compare @ depth ${depth}\nFEN: ${fen}\n`);
  const results: { kind: string; r: MoveResult }[] = [];
  for (const kind of backends) {
    const backend = createEngineBackend(kind);
    try {
      const r = await backend.analyze(fen, { depth });
      results.push({ kind, r });
      console.log(
        `${kind.padEnd(5)} [${backend.id().engine}] best ${r.uci} (${san(fen, r.uci)})  score ${r.scoreCp}cp` +
          `${r.mate !== null ? ` mate ${r.mate}` : ''}  pv ${r.pv.join(' ')}  nodes ${r.nodes}  time ${r.timeMs}ms`,
      );
    } finally {
      backend.dispose();
    }
  }
  if (results.length === 2) {
    const [a, b] = results;
    console.log(`\nsameMove: ${a!.r.uci === b!.r.uci}`);
    console.log(`scoreDiff (${b!.kind} − ${a!.kind}): ${b!.r.scoreCp - a!.r.scoreCp}cp`);
    console.log(`speedup (${a!.kind}/${b!.kind}): ${(a!.r.timeMs / Math.max(1, b!.r.timeMs)).toFixed(1)}×`);
  }
}

main().catch((e) => {
  console.error('engine:compare failed:', e);
  process.exit(1);
});
