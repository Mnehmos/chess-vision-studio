// Export the full analysis as a structured JSON snapshot: the literal on-screen view
// state (current ply) PLUS the complete per-ply analysis for EVERY ply. buildBoardExport
// is PURE + testable; downloadJson is the browser sink.
import { squareReport } from '../engine/relationship';
import { renderInsight } from '../engine/explain';
import { extractPlyFeatures, controlShare, type PlyFeatures } from '../engine/features';
import type { ParsedGame, PlyRecord } from '../engine/position';
import type { InsightCandidate, LedMap, MoveAnalysis, Square } from '../engine/types';
import type { TeachingRecordV1 } from '../engine/teaching/record';
import { ARROW, type Arrow } from './BoardArrows';

export interface BoardExportInput {
  game?: ParsedGame;
  plies: PlyRecord[];
  view: number; // 0 = start, k = after move k (drives the `current` block)
  fen: string;
  modeId: string;
  selected?: Square;
  focused?: InsightCandidate | null;
  moveLabel?: string; // e.g. "10. dxe4"
  ledMap: LedMap;
  arrows: Arrow[];
  analyses: Map<number, MoveAnalysis>; // per-ply analysis (index = ply-1)
  commentary: Map<number, string>; // per-ply coach text (index = ply-1)
  teaching?: Map<number, TeachingRecordV1>; // per-ply teaching corpus record (index = ply-1)
  annotations: { showThreats: boolean; showAllThreats: boolean; cascade: boolean; followMove: boolean };
  exportedAt: string; // ISO timestamp (caller supplies — keeps this pure)
}

// Map an arrow colour back to its semantic role so the JSON is self-describing.
const ARROW_KIND: Record<string, string> = {
  [ARROW.attack]: 'attack',
  [ARROW.defend]: 'defend',
  [ARROW.tactical]: 'tactical',
  [ARROW.move]: 'played_move',
};

function sideToMove(fen: string): 'white' | 'black' {
  return fen.trim().split(/\s+/)[1] === 'b' ? 'black' : 'white';
}

function slimInsight(ins: InsightCandidate) {
  return {
    kind: ins.kind,
    type: ins.type,
    side: ins.side,
    source: ins.source,
    squares: ins.squares,
    saliency: ins.saliency,
    materialSwing: ins.materialSwing,
    inPV: ins.inPV,
    templateId: ins.templateId,
    rendered: renderInsight(ins),
    evidence: ins.evidence,
  };
}

function analysisBlock(a: MoveAnalysis) {
  return {
    san: a.move,
    classification: a.classification,
    cpLoss: a.cpLoss,
    topExplanation: a.topExplanation,
    positionId: a.positionId ?? null,
    evalBefore: a.evalBefore,
    evalAfter: a.evalAfter,
    mateProof: a.mateProof ?? null,
    confidence: a.confidence ?? null,
    deepCheck: a.deepCheck ?? null,
    rankedInsights: a.rankedInsights.map(slimInsight),
  };
}

// "Unknown is safer than zero": never serialize placeholder zeros as if measured.
//   • un-analyzed ply         → { computed: false, reason: 'not_analyzed' }
//   • extraction quarantined  → { computed: false, reason: 'feature_extraction_failed' }
//   • real features           → { computed: true, ...the measured values }
function featuresBlock(features: PlyFeatures | null) {
  if (!features) return { computed: false as const, reason: 'not_analyzed' };
  if (features.quarantined) return { computed: false as const, reason: 'feature_extraction_failed' };
  return {
    computed: true as const,
    phase: features.phase,
    badges: features.badges,
    boardControl: controlShare(features.threatAfter),
    kingPressure: { white: features.threatAfter.whiteKingPressure, black: features.threatAfter.blackKingPressure },
    loosePieces: features.defenseAfter.loosePieces,
    hangingValue: features.defenseAfter.hangingValue,
    bestSafeCapture: features.see.bestWin,
    detail: features, // the full PlyFeatures, for completeness
  };
}

// Per-ply teaching corpus record. unknown != none: a ply with no committed record
// is reported explicitly, never as an absent/empty field.
function teachingBlock(record: TeachingRecordV1 | undefined, requested: boolean) {
  if (record) return { computed: true as const, ...record };
  return { computed: false as const, reason: requested ? 'no_committed_record' : 'not_requested' };
}

/** Assemble a complete JSON snapshot: the current on-screen view + every ply's analysis. */
export function buildBoardExport(input: BoardExportInput) {
  const {
    game,
    plies,
    view,
    fen,
    modeId,
    selected,
    focused,
    moveLabel,
    ledMap,
    arrows,
    analyses,
    commentary,
    teaching,
    annotations,
    exportedAt,
  } = input;

  const currentAnalysis = view > 0 ? analyses.get(view - 1) : undefined;

  return {
    app: 'chess-vision-studio',
    view: 'board' as const,
    exportedAt,
    game: {
      headers: game?.headers ?? {},
      plyCount: plies.length,
      analyzedPlies: analyses.size,
      commentedPlies: commentary.size,
      teachingRecords: teaching ? teaching.size : 0,
    },
    // The literal on-screen state for the ply currently displayed.
    current: {
      ply: view,
      fen,
      sideToMove: sideToMove(fen),
      move: currentAnalysis
        ? { label: moveLabel ?? currentAnalysis.move, ...analysisBlock(currentAnalysis) }
        : null,
      mode: { id: modeId, ledMap },
      selectedSquare: selected ? { square: selected, report: squareReport(fen, selected) } : null,
      coachCommentary: view > 0 ? commentary.get(view - 1) ?? null : null,
      annotations: {
        ...annotations,
        focused: focused ? slimInsight(focused) : null,
        arrows: arrows.map((a) => ({
          from: a.from,
          to: a.to,
          kind: ARROW_KIND[a.color] ?? 'other',
          dashed: !!a.dashed,
          label: a.label ?? null,
        })),
      },
    },
    // The full analysis for EVERY ply (the same data the board surfaces as you step).
    plies: plies.map((p, i) => {
      const a = analyses.get(i);
      // Use the BARE SAN (p.san), never the formatted label (a.move = "16. Rxe4"),
      // which chess.js can't parse → would quarantine the whole ply to zeros.
      // extractPlyFeatures is itself fail-soft (it flags .quarantined, never throws).
      const features = a ? featuresBlock(extractPlyFeatures(a.positionBefore, a.positionAfter, p.san, a)) : featuresBlock(null);
      return {
        ply: i + 1,
        moveNumber: p.moveNumber,
        color: p.color === 'w' ? 'white' : 'black',
        san: p.san,
        from: p.from,
        to: p.to,
        fenBefore: p.fenBefore,
        fenAfter: p.fenAfter,
        analysis: a ? analysisBlock(a) : null,
        features,
        teaching: teachingBlock(teaching?.get(i), !!teaching),
        coachCommentary: commentary.get(i) ?? null,
      };
    }),
  };
}

export type BoardExport = ReturnType<typeof buildBoardExport>;

/** A readable filename for the snapshot. */
export function boardExportFilename(game: ParsedGame | undefined): string {
  const slug = (s: string) =>
    s.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '') || 'game';
  const w = slug(game?.headers?.White ?? 'white');
  const b = slug(game?.headers?.Black ?? 'black');
  return `cvs-${w}-vs-${b}.json`;
}

/** Browser sink: trigger a download of `data` as pretty-printed JSON. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(filename, blob);
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
