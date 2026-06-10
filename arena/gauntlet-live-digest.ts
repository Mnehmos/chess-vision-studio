// Live per-game digest — polls a running gauntlet run dir and prints a compact
// analysis of each game as it completes. Deliberately Stockfish-free (zero
// contention with the match): uses the engine's own telemetry — self-eval
// trajectory, depth-reached distribution (clock mode), time profile — and flags
// games for the post-run SF forensic queue.
//
//   npm run gauntlet:digest            (auto-detects newest run dir)
//   npm run gauntlet:digest -- --run arena/gauntlet/runs/<id>
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

interface GameRow {
  gameId: string;
  opponentEloLabel: number;
  cvsColor: string;
  openingId: string;
  result: string;
  cvsResult: string;
  plies: number;
  termination: string;
}

interface MoveRow {
  gameId: string;
  ply: number;
  cvsScore: number;
  cvsDepth: number;
  timeMs: number;
  nodes: number;
}

function newestRunDir(): string {
  const base = 'arena/gauntlet/runs';
  const dirs = readdirSync(base)
    .map((d) => `${base}/${d}`)
    .filter((d) => statSync(d).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!dirs[0]) throw new Error('no run dirs');
  return dirs[0];
}

function digest(game: GameRow, moves: MoveRow[]): string {
  const lines: string[] = [];
  const icon = game.cvsResult === 'win' ? '✅' : game.cvsResult === 'draw' ? '🤝' : '❌';
  lines.push(
    `${icon} ${game.gameId} ${game.openingId} cvs=${game.cvsColor[0]?.toUpperCase()} → ${game.result} (${game.termination}, ${game.plies} plies)`,
  );
  if (moves.length === 0) return lines.join('\n');
  // Depth distribution (clock mode: how deep did 500ms get us?)
  const byDepth = new Map<number, number>();
  for (const m of moves) byDepth.set(m.cvsDepth, (byDepth.get(m.cvsDepth) ?? 0) + 1);
  const dist = [...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `d${d}×${n}`).join(' ');
  const avgT = moves.reduce((a, b) => a + b.timeMs, 0) / moves.length;
  const maxT = Math.max(...moves.map((m) => m.timeMs));
  lines.push(`   depth: ${dist} | time avg ${avgT.toFixed(0)}ms max ${maxT}ms`);
  // Self-eval trajectory (every ~8 CVS moves) + swing detection.
  const step = Math.max(1, Math.floor(moves.length / 8));
  const traj = moves
    .filter((_, i) => i % step === 0)
    .map((m) => `p${m.ply}:${m.cvsScore > 99000 ? '+M' : m.cvsScore < -99000 ? '-M' : m.cvsScore}`)
    .join(' ');
  lines.push(`   self-eval: ${traj}`);
  const firstBad = moves.find((m) => m.cvsScore < -75);
  const peak = moves.reduce((a, b) => (b.cvsScore > a.cvsScore && b.cvsScore < 99000 ? b : a), moves[0]!);
  if (game.cvsResult !== 'win') {
    lines.push(
      `   ⚠ swing: peak +${peak.cvsScore}@p${peak.ply}, first <-75 at p${firstBad?.ply ?? '—'} → QUEUED for SF forensic`,
    );
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  let run = '';
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--run') run = argv[++i] ?? '';
  if (!run) run = newestRunDir();
  console.log(`digesting ${run} (poll 10s, Ctrl+C to stop)\n`);
  const seen = new Set<string>();
  for (;;) {
    if (existsSync(`${run}/games.jsonl`)) {
      const games: GameRow[] = readFileSync(`${run}/games.jsonl`, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
      const moves: MoveRow[] = existsSync(`${run}/moves.jsonl`)
        ? readFileSync(`${run}/moves.jsonl`, 'utf8')
            .split('\n')
            .filter((l) => l.trim())
            .map((l) => JSON.parse(l))
        : [];
      for (const g of games) {
        if (seen.has(g.gameId)) continue;
        seen.add(g.gameId);
        console.log(digest(g, moves.filter((m) => m.gameId === g.gameId)) + '\n');
      }
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

main().catch((e) => {
  console.error('digest failed:', e);
  process.exit(1);
});
