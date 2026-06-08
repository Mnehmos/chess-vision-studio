// Selective DEEP re-search for forcing/sacrificial moves (§ forcing-line override).
//
// The honest fix for "depth-14 calls Kasparov's 24.Rxd4 an inaccuracy": the
// explanation layer is NOT lying — the shallow eval genuinely misjudges long
// forcing sacrifices. So we make the ORACLE smarter on exactly those moves
// (re-search deeper) and report what the deeper search says — never overriding
// the eval with a heuristic "this must be brilliant" claim (Invariant 4). When
// even the deeper search still reads the move as adverse, we say so AND flag that
// sharp forcing lines can outrun the search — epistemic humility, not bravado.
//
// PURE: the deepening I/O lives in analyzeMoveLive; everything here is testable
// without an engine.
import { Chess } from 'chess.js';
import { seeCapture, seeOnSquare } from './see';
import type { Classification, MoveAnalysis } from './types';

/** Defaults for the deeper pass. Deeper than the base 14, with a longer budget. */
export const DEEP_CHECK_DEPTH = 22;
export const DEEP_CHECK_TIMEOUT_MS = 30000;

// Classification bands that warrant a deeper look. 'good' (cpLoss 0.3–0.6) is left
// alone — only genuine inaccuracy/mistake/blunder verdicts on FORCING moves qualify.
const ADVERSE: ReadonlySet<Classification> = new Set(['inaccuracy', 'mistake', 'blunder']);

/** True for the classifications a deeper search might rehabilitate. */
export function isAdverse(c: Classification): boolean {
  return ADVERSE.has(c);
}

/** A check, capture, promotion, or mate — a move that forces the reply.
 *  (chess.js always renders a checking move with a trailing '+'/'#'.) */
export function isForcingMove(san: string): boolean {
  return /[+#=]/.test(san) || san.includes('x');
}

/**
 * A move that GIVES UP material on its own square: a SEE-losing capture (24.Rxd4
 * nets −3), or a quiet move that plants its own piece en prise. Both are the
 * signature of a real sacrifice — the case depth-14 most often misreads.
 * A king move can never be "en prise" (chess.js forbids moving into check), so
 * the king sentinel (1000) never pollutes this.
 */
export function isSacrifice(fenBefore: string, san: string): boolean {
  try {
    const chess = new Chess(fenBefore);
    const m = chess.move(san);
    if (!m) return false;
    if (m.flags.includes('c') || m.flags.includes('e')) {
      return seeCapture(fenBefore, m.from, m.to) < 0;
    }
    // Non-capture: did the moved piece land where the opponent wins it by SEE?
    return seeOnSquare(chess.fen(), m.to).swing > 0;
  } catch {
    return false;
  }
}

/**
 * Should this shallow verdict be re-searched deeper, and why? Returns the trigger
 * reason ('sacrifice' | 'forcing') or null. Only ADVERSE verdicts on FORCING or
 * SACRIFICIAL moves qualify — a quiet positional inaccuracy stays at base depth
 * (those are not the long-forcing-line case, and re-searching every wobble is
 * wasteful). Sacrifice is checked first because it is the more informative label.
 */
export function deepCheckTrigger(
  fenBefore: string,
  san: string,
  shallow: MoveAnalysis,
): 'sacrifice' | 'forcing' | null {
  if (!isAdverse(shallow.classification)) return null;
  if (isSacrifice(fenBefore, san)) return 'sacrifice';
  if (isForcingMove(san)) return 'forcing';
  return null;
}

/**
 * Fold a deeper re-analysis together with the shallow one into the final analysis:
 * attach the DeepCheck record and rewrite the headline honestly.
 *   • 'sound'  — the deeper search lifted it OUT of the adverse band. Surface that
 *                a forcing line the shallow search misjudged actually holds up.
 *   • 'stands' — still adverse. Keep the deeper tactical explanation AND append a
 *                caution: sharp forcing/sacrificial lines can exceed even deep search.
 * `deep` already carries the deeper evals/insights (it came from analyzeMove on the
 * deeper evals); we only adjust the prose and record provenance.
 */
export function withDeepCheck(
  deep: MoveAnalysis,
  shallow: MoveAnalysis,
  depth: number,
  trigger: 'sacrifice' | 'forcing',
): MoveAnalysis {
  const stands = isAdverse(deep.classification);
  const kind = trigger === 'sacrifice' ? 'sacrifice' : 'forcing line';
  const note = stands
    ? `Deep-checked to depth ${depth}: still ${deep.classification} (−${deep.cpLoss.toFixed(1)}). Sharp ${trigger === 'sacrifice' ? 'sacrifices' : 'forcing lines'} can outrun even deep search — treat this verdict with caution.`
    : `${deep.move} — a ${kind} that depth-${shallow.deepCheck?.baseDepth ?? shallow.evalBefore.depth} misjudged as ${shallow.classification} (−${shallow.cpLoss.toFixed(1)}); depth-${depth} re-scores it ${deep.classification}.`;
  return {
    ...deep,
    topExplanation: stands ? `${deep.topExplanation} (${note})` : note,
    deepCheck: {
      depth,
      baseDepth: shallow.evalBefore.depth,
      trigger,
      verdict: stands ? 'stands' : 'sound',
      shallowCpLoss: shallow.cpLoss,
      shallowClassification: shallow.classification,
    },
  };
}
