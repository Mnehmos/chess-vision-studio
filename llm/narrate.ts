// Clamped LLM narration (Invariant 8). The LLM receives ONLY the engine-VALIDATED
// MoveAnalysis facts and is instructed to narrate them - never to assert a tactic,
// evaluation, or move that isn't already in the facts. The oracle is ground truth;
// the LLM is a narrator on both ends.
import type { InsightCandidate, MoveAnalysis } from '../engine/types';
import { controlShare, type PlyFeatures } from '../engine/features';
import type { ChatClient, ChatMessage } from './openai';

const SYSTEM = `You are a chess coach for a 300-1400 rated player. You will be given
STRUCTURED, ENGINE-VALIDATED facts about ONE move (the move played, the eval verdict,
the salient changes, and the position's "obligation" facts: who controls territory,
king pressure, loose pieces, hanging material, pawn structure). Write 2-4 short,
plain-English sentences that help the player SEE what matters.

THINK IN OBLIGATIONS, not just material: a piece can be locally hanging yet the move
still bad because the king must survive a bigger threat (or locally hanging yet fine
because the opponent can't collect it in time). Use the king-pressure, king-escape,
and control facts to explain whose obligation is impossible to meet.

HARD RULES:
- Use ONLY the facts provided. Do NOT invent or infer any tactic, threat, evaluation,
  piece, or move that is not explicitly listed. If you are unsure, say less.
- Never claim a fork/pin/skewer/mate/etc. unless it appears in the facts.
- Refer to pieces and squares exactly as given. Keep it concrete and encouraging.
- If the facts say the move was solid/best with nothing important changed, say that briefly.`;

/** Render the validated facts as a compact, unambiguous block for the LLM. */
export function factsBlock(a: MoveAnalysis, features?: PlyFeatures): string {
  const lines: string[] = [];
  lines.push(`Move played: ${a.move}`);
  lines.push(`Classification: ${a.classification} (centipawn loss ${a.cpLoss.toFixed(2)} pawns)`);
  lines.push(`Engine summary: ${a.topExplanation}`);
  if (a.rankedInsights.length) {
    lines.push('Validated facts (most important first):');
    for (const ins of a.rankedInsights.slice(0, 5)) lines.push(`  - ${insightLine(ins)}`);
  } else {
    lines.push('No salient change (nothing important happened).');
  }
  if (features) {
    lines.push('Obligation facts (engine-derived, position after the move):');
    for (const f of obligationLines(features)) lines.push(`  - ${f}`);
  }
  return lines.join('\n');
}

/** The proof-obligation layer: territory, king safety, loose/hanging material, pawns.
 *  All engine-derived (trustworthy) — this is what lets the coach explain WHY a locally
 *  loose piece is or isn't the real problem, without ever seeing the raw board. */
export function obligationLines(features: PlyFeatures): string[] {
  const t = features.threatAfter;
  const c = controlShare(t);
  const d = features.defenseAfter;
  const p = features.pawnAfter;
  const see = features.see;
  const out: string[] = [];

  out.push(
    `Board control: White attacks ~${c.whitePct}% of squares (${c.exclusiveWhitePct}% exclusively), ` +
      `Black ~${c.blackPct}% (${c.exclusiveBlackPct}% exclusively), ${c.contestedPct}% contested. ` +
      `Center (d4/e4/d5/e5): White ${c.centerWhite}/4, Black ${c.centerBlack}/4.`,
  );
  out.push(
    `King pressure (attacked squares around each king): White king ${t.whiteKingPressure}, ` +
      `Black king ${t.blackKingPressure}. Side-to-move king escape squares: ${features.opponentLegalAfter.kingEscapes}.`,
  );
  out.push(`Loose pieces (no defender): White ${d.loosePieces.w}, Black ${d.loosePieces.b}.`);
  out.push(
    `Hanging / SEE-losing value (pawns): White ${d.hangingValue.w}, Black ${d.hangingValue.b}. ` +
      `Best safe capture available: White +${see.bestWin.w}, Black +${see.bestWin.b}.`,
  );
  out.push(
    `Pawn structure — isolated W${p.isolated.w}/B${p.isolated.b}, doubled W${p.doubled.w}/B${p.doubled.b}, ` +
      `passed W${p.passed.w}/B${p.passed.b}; king-shield pawns missing W${p.kingShieldMissing.w}/B${p.kingShieldMissing.b}.`,
  );
  const tactics = motifTally(features);
  if (tactics) out.push(`Proven tactics on the board: ${tactics}.`);
  return out;
}

function motifTally(features: PlyFeatures): string | null {
  const merged: Record<string, number> = {};
  for (const src of [features.motifs.availableBefore, features.motifs.refutation, features.motifs.createdAfter]) {
    for (const [k, n] of Object.entries(src)) merged[k] = (merged[k] ?? 0) + (n ?? 0);
  }
  const parts = Object.entries(merged)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k.replace(/_/g, ' ')}×${n}`);
  return parts.length ? parts.join(', ') : null;
}

function insightLine(ins: InsightCandidate): string {
  const who = ins.side === 'white' ? 'White' : 'Black';
  const where = ins.squares.join(', ');
  const base =
    ins.kind === 'motif'
      ? `${who} ${ins.type.replace(/_/g, ' ')} (line: ${ins.line.join(' ')})`
      : `${ins.type.replace(/_/g, ' ')} on ${where}`;
  const detail: string[] = [];
  if (ins.source === 'available') detail.push('a chance the mover passed up');
  if (ins.source === 'refutation') detail.push("the opponent's punishing reply");
  if (ins.materialSwing) detail.push(`material ${ins.materialSwing > 0 ? '+' : ''}${ins.materialSwing}`);
  if (ins.evidence[0]) detail.push(ins.evidence[0]);
  return `${base}${detail.length ? ' - ' + detail.join('; ') : ''} [${where}]`;
}

export function buildNarrationMessages(a: MoveAnalysis, features?: PlyFeatures): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: factsBlock(a, features) },
  ];
}

export async function narrate(client: ChatClient, a: MoveAnalysis, features?: PlyFeatures): Promise<string> {
  return client.chat(buildNarrationMessages(a, features));
}
