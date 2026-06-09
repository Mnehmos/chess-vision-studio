// chess.js perft baseline — to compare movegen throughput against the Rust
// CVS Bitboard Core. chess.js is the library the current TS engine uses; this is
// what the bitboard core is meant to eventually replace for the hot path.
//   npm run perft:chessjs
import { Chess } from 'chess.js';

function perft(chess: Chess, depth: number): number {
  if (depth === 0) return 1;
  const moves = chess.moves({ verbose: true });
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) {
    chess.move(m);
    n += perft(chess, depth - 1);
    chess.undo();
  }
  return n;
}

const CASES: { name: string; fen: string; depths: number[] }[] = [
  { name: 'startpos', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', depths: [2, 3, 4] },
  { name: 'kiwipete', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', depths: [2, 3] },
];

console.log('chess.js perft (movegen throughput baseline)\n');
console.log('| Position | Depth | Nodes | Time(s) | Nodes/s |');
console.log('|---|---:|---:|---:|---:|');
for (const c of CASES) {
  for (const d of c.depths) {
    const chess = new Chess(c.fen);
    const t = Date.now();
    const nodes = perft(chess, d);
    const secs = (Date.now() - t) / 1000;
    const nps = secs > 0 ? Math.round(nodes / secs) : 0;
    console.log(`| ${c.name} | ${d} | ${nodes} | ${secs.toFixed(3)} | ${nps} |`);
  }
}
