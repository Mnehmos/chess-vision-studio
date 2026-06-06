// Dataset aggregation — roll a full game export up into the numbers worth
// visualizing: who the player is, their record by color, how openings perform,
// and a score-over-time series. Pure & structural (no engine needed), so it runs
// instantly over hundreds of games. Engine-surfaced metrics can be folded in later.
import type { ParsedGame } from './position';

export type ResultStr = '1-0' | '0-1' | '1/2-1/2' | '*';

export interface GameSummary {
  index: number;
  white: string;
  black: string;
  result: ResultStr;
  date: string | null; // 'YYYY.MM.DD' or null
  plies: number;
  opening: string;
  heroColor: 'w' | 'b' | null;
  heroScore: number | null; // 1 win / 0.5 draw / 0 loss, null if hero not in this game
}

export interface InterestingGame {
  index: number;
  score: number;
  reasons: string[];
}

export interface Record4 {
  games: number;
  wins: number;
  draws: number;
  losses: number;
}

export interface OpeningRecord extends Record4 {
  name: string;
  score: number; // hero points (win 1, draw 0.5)
}

export interface DatasetStats {
  hero: string | null;
  totalGames: number;
  byResult: { whiteWins: number; blackWins: number; draws: number; other: number };
  heroRecord: Record4 & { winPct: number; scorePct: number };
  asWhite: Record4;
  asBlack: Record4;
  openings: OpeningRecord[]; // hero perspective, most-played first
  timeline: { index: number; date: string | null; heroScore: number | null; cumulative: number }[];
  summaries: GameSummary[];
  interestingGames: InterestingGame[];
}

function normResult(r: string | undefined): ResultStr {
  return r === '1-0' || r === '0-1' || r === '1/2-1/2' ? r : '*';
}

/** The player appearing in the most games (and in over half of them) is the hero. */
export function detectHero(games: ParsedGame[]): string | null {
  const counts = new Map<string, number>();
  for (const g of games) {
    for (const name of [g.headers.White, g.headers.Black]) {
      if (name && name !== '?') counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [name, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = name;
    }
  }
  return bestN > games.length / 2 && bestN >= 2 ? best : null;
}

function deriveOpening(g: ParsedGame): string {
  const eco = g.headers.ECO?.trim();
  const named = g.headers.Opening?.trim();
  if (named) return eco && !named.includes(eco) ? `${named} (${eco})` : named;
  if (eco) return `${ECO_NAMES[eco] ?? ecoFamilyName(eco)} (${eco})`;
  // Fall back to the first few moves as a signature.
  const sig: string[] = [];
  for (let i = 0; i < Math.min(6, g.plies.length); i++) {
    const p = g.plies[i];
    sig.push(p.color === 'w' ? `${p.moveNumber}.${p.san}` : p.san);
  }
  return sig.join(' ') || 'Unknown';
}

const ECO_NAMES: Record<string, string> = {
  A00: 'Uncommon Opening',
  A01: 'Nimzowitsch-Larsen Attack',
  A02: 'Bird Opening',
  A03: 'Bird Opening',
  A04: 'Reti Opening',
  A05: 'Reti Opening',
  A06: 'Reti Opening',
  A10: 'English Opening',
  A20: 'English Opening',
  B00: "King's Pawn Opening",
  B01: 'Scandinavian Defense',
  B02: "Alekhine's Defense",
  B06: 'Modern Defense',
  B07: 'Pirc Defense',
  B10: 'Caro-Kann Defense',
  B20: 'Sicilian Defense',
  B30: 'Sicilian Defense',
  B40: 'Sicilian Defense',
  C00: 'French Defense',
  C20: "King's Pawn Game",
  C21: "Center Game",
  C22: "Center Game",
  C23: "Bishop's Opening",
  C24: "Bishop's Opening",
  C25: 'Vienna Game',
  C26: 'Vienna Game',
  C27: 'Vienna Game',
  C28: 'Vienna Game',
  C30: "King's Gambit",
  C40: "King's Knight Opening",
  C41: 'Philidor Defense',
  C42: "Petrov's Defense",
  C44: "King's Pawn Game",
  C45: 'Scotch Game',
  C46: 'Three Knights Game',
  C47: 'Four Knights Game',
  C50: 'Italian Game',
  C60: 'Ruy Lopez',
  D00: "Queen's Pawn Game",
  D01: "Queen's Pawn Game",
  D02: "Queen's Pawn Game",
  D03: 'Torre Attack',
  D04: 'Colle System',
  D06: "Queen's Gambit",
  D10: 'Slav Defense',
  D20: "Queen's Gambit Accepted",
  D30: "Queen's Gambit Declined",
  E00: "Queen's Pawn Game",
  E10: 'Indian Defense',
  E20: 'Nimzo-Indian Defense',
  E60: "King's Indian Defense",
};

function ecoFamilyName(eco: string): string {
  const family = eco[0];
  if (family === 'A') return 'Flank or irregular opening';
  if (family === 'B') return 'Semi-open defense';
  if (family === 'C') return 'Open game';
  if (family === 'D') return "Queen's pawn opening";
  if (family === 'E') return 'Indian defense';
  return 'Opening';
}

function heroScoreFor(color: 'w' | 'b', result: ResultStr): number | null {
  if (result === '1/2-1/2') return 0.5;
  if (result === '1-0') return color === 'w' ? 1 : 0;
  if (result === '0-1') return color === 'b' ? 1 : 0;
  return null; // '*' unfinished
}

function emptyRecord(): Record4 {
  return { games: 0, wins: 0, draws: 0, losses: 0 };
}

function addScore(rec: Record4, score: number | null) {
  if (score === null) return;
  rec.games += 1;
  if (score === 1) rec.wins += 1;
  else if (score === 0.5) rec.draws += 1;
  else rec.losses += 1;
}

export function computeDataset(games: ParsedGame[]): DatasetStats {
  const hero = detectHero(games);
  const byResult = { whiteWins: 0, blackWins: 0, draws: 0, other: 0 };
  const asWhite = emptyRecord();
  const asBlack = emptyRecord();
  const openingMap = new Map<string, OpeningRecord>();
  const summaries: GameSummary[] = [];

  for (const g of games) {
    const result = normResult(g.headers.Result);
    if (result === '1-0') byResult.whiteWins += 1;
    else if (result === '0-1') byResult.blackWins += 1;
    else if (result === '1/2-1/2') byResult.draws += 1;
    else byResult.other += 1;

    const heroColor: 'w' | 'b' | null =
      hero && g.headers.White === hero ? 'w' : hero && g.headers.Black === hero ? 'b' : null;
    const heroScore = heroColor ? heroScoreFor(heroColor, result) : null;
    const opening = deriveOpening(g);

    summaries.push({
      index: g.index,
      white: g.headers.White ?? '?',
      black: g.headers.Black ?? '?',
      result,
      date: g.headers.Date && g.headers.Date !== '????.??.??' ? g.headers.Date : null,
      plies: g.plies.length,
      opening,
      heroColor,
      heroScore,
    });

    if (heroColor) {
      addScore(heroColor === 'w' ? asWhite : asBlack, heroScore);
      let rec = openingMap.get(opening);
      if (!rec) {
        rec = { name: opening, ...emptyRecord(), score: 0 };
        openingMap.set(opening, rec);
      }
      addScore(rec, heroScore);
      if (heroScore !== null) rec.score += heroScore;
    }
  }

  const heroGames = asWhite.games + asBlack.games;
  const heroWins = asWhite.wins + asBlack.wins;
  const heroDraws = asWhite.draws + asBlack.draws;
  const heroLosses = asWhite.losses + asBlack.losses;
  const heroScoreSum = heroWins + heroDraws * 0.5;
  const heroRecord = {
    games: heroGames,
    wins: heroWins,
    draws: heroDraws,
    losses: heroLosses,
    winPct: heroGames ? (heroWins / heroGames) * 100 : 0,
    scorePct: heroGames ? (heroScoreSum / heroGames) * 100 : 0,
  };

  // Time-series: order by date when present, else by game index; cumulate hero score.
  const ordered = [...summaries].sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.index - b.index;
  });
  let cumulative = 0;
  const timeline = ordered.map((s) => {
    if (s.heroScore !== null) cumulative += s.heroScore;
    return { index: s.index, date: s.date, heroScore: s.heroScore, cumulative };
  });

  const openings = [...openingMap.values()].sort((a, b) => b.games - a.games);
  const interestingGames = summaries
    .map((s) => interestFor(s, openingMap.get(s.opening)))
    .filter((g) => g.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return {
    hero,
    totalGames: games.length,
    byResult,
    heroRecord,
    asWhite,
    asBlack,
    openings,
    timeline,
    summaries,
    interestingGames,
  };
}

function interestFor(s: GameSummary, opening: OpeningRecord | undefined): InterestingGame {
  let score = 0;
  const reasons: string[] = [];
  if (s.heroScore === 0) {
    score += 4;
    reasons.push(`loss as ${s.heroColor === 'w' ? 'White' : 'Black'}`);
  } else if (s.heroScore === 0.5) {
    score += 1;
    reasons.push('drawn game');
  }
  if (s.heroScore === 0 && s.plies <= 30) {
    score += 3;
    reasons.push('short loss');
  }
  if (s.heroScore === 1 && s.plies <= 30) {
    score += 1;
    reasons.push('quick win to study');
  }
  if (s.plies >= 90) {
    score += 1;
    reasons.push('long game');
  }
  if (opening && opening.games >= 5) {
    const scorePct = opening.score / opening.games;
    if (scorePct < 0.45) {
      score += 2;
      reasons.push(`opening scores ${(scorePct * 100).toFixed(0)}% over ${opening.games} games`);
    }
  }
  if (s.result === '*') {
    score += 1;
    reasons.push('unfinished result');
  }
  return { index: s.index, score, reasons };
}
