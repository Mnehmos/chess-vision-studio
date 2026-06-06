// Clamped LLM narration (Invariant 8). The LLM receives ONLY the engine-VALIDATED
// MoveAnalysis facts and is instructed to narrate them — never to assert a tactic,
// evaluation, or move that isn't already in the facts. The oracle is ground truth;
// the LLM is a narrator on both ends.
import type { InsightCandidate, MoveAnalysis } from '../engine/types';
import type { ChatClient, ChatMessage } from './openai';

const SYSTEM = `You are a chess coach for a 300–1400 rated player. You will be given
STRUCTURED, ENGINE-VALIDATED facts about ONE move. Write 1–3 short, plain-English
sentences that help the player SEE what matters.

HARD RULES:
- Use ONLY the facts provided. Do NOT invent or infer any tactic, threat, evaluation,
  piece, or move that is not explicitly listed. If you are unsure, say less.
- Never claim a fork/pin/skewer/mate/etc. unless it appears in the facts.
- Refer to pieces and squares exactly as given. Keep it concrete and encouraging.
- If the facts say the move was solid/best with nothing important changed, say that briefly.`;

/** Render the validated facts as a compact, unambiguous block for the LLM. */
export function factsBlock(a: MoveAnalysis): string {
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
  return lines.join('\n');
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
  return `${base}${detail.length ? ' — ' + detail.join('; ') : ''} [${where}]`;
}

export function buildNarrationMessages(a: MoveAnalysis): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: factsBlock(a) },
  ];
}

export async function narrate(client: ChatClient, a: MoveAnalysis): Promise<string> {
  return client.chat(buildNarrationMessages(a));
}
