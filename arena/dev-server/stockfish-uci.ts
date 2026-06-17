export interface StockfishSearchBest {
  depth: number;
  scoreCp: number;
  mate: number | null;
  pv: string[];
}

export function parseStockfishInfoLine(line: string): StockfishSearchBest | null {
  if (!line.startsWith('info ') || !line.includes(' score ') || !line.includes(' pv ')) {
    return null;
  }
  const t = line.split(/\s+/);
  const di = t.indexOf('depth');
  const si = t.indexOf('score');
  const pi = t.indexOf('pv');
  if (si < 0 || pi < 0) return null;

  let scoreCp = 0;
  let mate: number | null = null;
  if (t[si + 1] === 'cp') scoreCp = Number(t[si + 2]);
  else if (t[si + 1] === 'mate') mate = Number(t[si + 2]);
  else return null;

  return {
    depth: di >= 0 ? Number(t[di + 1]) : 0,
    scoreCp,
    mate,
    pv: t.slice(pi + 1),
  };
}

export function parseStockfishBestMove(line: string): string | null {
  if (!line.startsWith('bestmove')) return null;
  return line.split(/\s+/)[1] ?? '(none)';
}
