// Weakness analyzer for the LIVE-harvest dataset. The bot reviews every game it
// plays with Stockfish d24 and appends reviewed CVS moves to lichess-dataset.jsonl.
// This reads those rows and profiles where CVS bleeds eval in REAL games: by game
// phase, move classification, cpLoss, and recurring motifs. Complements the directed
// self-play probe (which targets specific structures) with broad real-game signal.
//
// Run:  npx vite-node --script arena/weakness/analyze-harvest.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const IN = process.env.HARVEST_IN ?? 'arena/out/lichess-dataset.jsonl';
const OUT = process.env.HARVEST_OUT ?? 'arena/out/weakness/harvest-report.md';

interface Row {
  cpLoss?: number;
  classification?: string;
  source?: string;
  fen?: string;
  playedMove?: string;
  bestMove?: string;
  gameId?: string;
  evalBefore?: number;
  features?: { phase?: string; motifs?: string[] };
}

const PHASES = ['opening', 'middlegame', 'midgame', 'middle', 'endgame', 'unknown'];
const avg = (xs: number[]) => (xs.length ? Math.round((100 * xs.reduce((a, b) => a + b, 0)) / xs.length) / 100 : 0);
const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((1000 * n) / d) / 10);

function main() {
  mkdirSync('arena/out/weakness', { recursive: true });
  if (!existsSync(IN)) {
    writeFileSync(OUT, `# Harvest weakness report\n\nNo dataset at ${IN} yet.\n`, 'utf8');
    console.log(`no dataset at ${IN}`);
    return;
  }
  const rows: Row[] = readFileSync(IN, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as Row;
      } catch {
        return null;
      }
    })
    .filter((r): r is Row => !!r);

  // CVS's own reviewed moves
  const cvs = rows.filter((r) => r.source === 'bot_game' && typeof r.cpLoss === 'number');
  const isBlunder = (r: Row) => (r.classification ?? '') === 'blunder';
  const isMistake = (r: Row) => ['mistake', 'blunder'].includes(r.classification ?? '');
  const isInacc = (r: Row) => ['inaccuracy', 'mistake', 'blunder'].includes(r.classification ?? '');

  const phaseOf = (r: Row) => {
    const p = (r.features?.phase ?? 'unknown').toLowerCase();
    if (p.startsWith('open')) return 'opening';
    if (p.startsWith('mid')) return 'middlegame';
    if (p.startsWith('end')) return 'endgame';
    return 'unknown';
  };

  const lines: string[] = [];
  lines.push('# CVS harvest weakness report (real Lichess games, SF-d24 reviewed)');
  lines.push('');
  lines.push(`Reviewed CVS moves: ${cvs.length} | distinct games: ${new Set(cvs.map((r) => r.gameId)).size}`);
  lines.push(`Overall: inaccuracy+ ${pct(cvs.filter(isInacc).length, cvs.length)}% | mistake+ ${pct(cvs.filter(isMistake).length, cvs.length)}% | blunder ${pct(cvs.filter(isBlunder).length, cvs.length)}% | avgCpLoss ${avg(cvs.map((r) => r.cpLoss ?? 0))}`);
  lines.push('');
  lines.push('## By game phase');
  lines.push('| phase | moves | avgCpLoss | inacc+ | mistake+ | blunder | worst motif |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const ph of ['opening', 'middlegame', 'endgame', 'unknown']) {
    const ms = cvs.filter((r) => phaseOf(r) === ph);
    if (!ms.length) continue;
    const motifs = ms.filter(isMistake).flatMap((r) => r.features?.motifs ?? []);
    const motifCount = motifs.reduce<Record<string, number>>((a, m) => ((a[m] = (a[m] ?? 0) + 1), a), {});
    const worstMotif = Object.entries(motifCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-';
    lines.push(`| ${ph} | ${ms.length} | ${avg(ms.map((r) => r.cpLoss ?? 0))} | ${pct(ms.filter(isInacc).length, ms.length)}% | ${pct(ms.filter(isMistake).length, ms.length)}% | ${pct(ms.filter(isBlunder).length, ms.length)}% | ${worstMotif} |`);
  }
  lines.push('');
  lines.push('## Recurring motifs in mistakes+ (all phases)');
  const allMotifs = cvs.filter(isMistake).flatMap((r) => r.features?.motifs ?? []);
  const mc = allMotifs.reduce<Record<string, number>>((a, m) => ((a[m] = (a[m] ?? 0) + 1), a), {});
  for (const [m, n] of Object.entries(mc).sort((a, b) => b[1] - a[1]).slice(0, 15)) lines.push(`- ${m}: ${n}`);
  lines.push('');
  lines.push('## Worst real-game blunders (highest cpLoss)');
  for (const r of cvs.filter(isMistake).sort((a, b) => (b.cpLoss ?? 0) - (a.cpLoss ?? 0)).slice(0, 25)) {
    lines.push(`- ${phaseOf(r)} −${r.cpLoss} (${r.classification}): played \`${r.playedMove}\`, SF best \`${r.bestMove}\`  [game ${r.gameId}]  \`${r.fen}\``);
  }

  writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log(`harvest report: ${cvs.length} CVS moves -> ${OUT}`);
  void PHASES;
}

main();
