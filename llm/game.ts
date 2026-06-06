// Whole-game commentary from the same clamped MoveAnalysis seam. This produces
// one compact prompt for a game-level call; per-ply batch calls still use batch.ts.
import type { MoveAnalysis } from '../engine/types';
import type { PlyInput } from './batch';
import type { ChatClient, ChatMessage } from './openai';

const GAME_SYSTEM = `You are a chess coach for a 300-1400 rated player. You will be given
STRUCTURED, ENGINE-VALIDATED facts from one analyzed game. Write a concise game
review with:
- 2-4 themes that actually repeat in the facts
- the most important turning points
- one concrete training takeaway

HARD RULES:
- Use ONLY the facts provided. Do NOT invent or infer any tactic, threat, evaluation,
  piece, or move that is not explicitly listed.
- Never claim a fork/pin/skewer/mate/etc. unless it appears in the facts.
- If the facts are sparse or quiet, say that briefly instead of embellishing.`;

export interface GameNarrationRequest {
  label?: string;
  items: PlyInput[];
  maxTeachingMoments?: number;
}

export function gameFactsBlock(req: GameNarrationRequest): string {
  const maxTeachingMoments = req.maxTeachingMoments ?? 24;
  const lines: string[] = [];
  lines.push(`Game: ${req.label ?? 'unlabeled'}`);
  lines.push(`Analyzed plies: ${req.items.length}`);
  lines.push(`Classification counts: ${classificationSummary(req.items.map((i) => i.analysis))}`);

  const moments = teachingMoments(req.items).slice(0, maxTeachingMoments);
  if (moments.length === 0) {
    lines.push('No major validated mistakes, motifs, or mate proofs were surfaced.');
    return lines.join('\n');
  }

  lines.push('Validated teaching moments, ordered by severity then ply:');
  for (const item of moments) {
    const a = item.analysis;
    const top = a.rankedInsights[0];
    lines.push(
      `  - Ply ${item.ply}: ${a.move}; ${a.classification}; loss ${a.cpLoss.toFixed(2)} pawns; ${a.topExplanation}`,
    );
    if (a.mateProof) {
      lines.push(`    mate proof: mate in ${a.mateProof.mateInMoves}; line ${a.mateProof.line.join(' ')}`);
    }
    if (top) {
      const details = [
        `type ${top.type}`,
        `source ${top.source}`,
        `squares ${top.squares.join(',')}`,
        `material ${signed(top.materialSwing)}`,
      ];
      if (top.kind === 'motif') details.push(`line ${top.line.join(' ')}`);
      if (top.evidence[0]) details.push(`evidence ${top.evidence[0]}`);
      lines.push(`    top validated fact: ${details.join('; ')}`);
    }
  }
  return lines.join('\n');
}

export function buildGameNarrationMessages(req: GameNarrationRequest): ChatMessage[] {
  return [
    { role: 'system', content: GAME_SYSTEM },
    { role: 'user', content: gameFactsBlock(req) },
  ];
}

export async function narrateGame(client: ChatClient, req: GameNarrationRequest): Promise<string> {
  return client.chat(buildGameNarrationMessages(req));
}

export function turnDraft(a: MoveAnalysis): string {
  const top = a.rankedInsights[0];
  const suffix = top ? ` Top validated fact: ${top.type.replace(/_/g, ' ')} on ${top.squares.join(', ')}.` : '';
  return `${a.move}: ${a.topExplanation}${suffix}`;
}

export function gameDraft(req: GameNarrationRequest): string {
  const moments = teachingMoments(req.items).slice(0, 5);
  if (moments.length === 0) return `${req.label ?? 'Game'}: no major validated tactical or evaluation swings surfaced.`;
  const lines = moments.map((item) => `${item.analysis.move} - ${item.analysis.topExplanation}`);
  return [`${req.label ?? 'Game'}: ${req.items.length} analyzed plies.`, ...lines].join('\n');
}

function teachingMoments(items: PlyInput[]): PlyInput[] {
  return [...items]
    .filter((item) => {
      const a = item.analysis;
      return a.cpLoss >= 1 || a.mateProof || a.rankedInsights.some((i) => i.kind === 'motif' || i.saliency >= 0.5);
    })
    .sort((a, b) => score(b.analysis) - score(a.analysis) || a.ply - b.ply);
}

function score(a: MoveAnalysis): number {
  const motifBoost = a.rankedInsights.some((i) => i.kind === 'motif') ? 2 : 0;
  const mateBoost = a.mateProof ? 100 : 0;
  return mateBoost + motifBoost + a.cpLoss;
}

function classificationSummary(analyses: MoveAnalysis[]): string {
  const counts: Record<string, number> = {};
  for (const a of analyses) counts[a.classification] = (counts[a.classification] ?? 0) + 1;
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
