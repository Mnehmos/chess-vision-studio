import type { PlyRecord } from '../engine/position';
import type { MoveAnalysis } from '../engine/types';
import type { TeachingFactsRequestV1 } from '../engine/teaching/types';
import { plyRecordToUci, sanLineToUci } from '../engine/adapters/uci-line';

// Build a teaching-facts request for one analyzed ply. Returns null when the
// Stockfish line cannot be replayed fully to UCI, which prevents stale or partial
// PV data from being treated as a valid teaching label.
export function factsRequestForPly(
  ply: PlyRecord,
  analysis: MoveAnalysis,
): TeachingFactsRequestV1 | null {
  try {
    const playedMoveUci = plyRecordToUci(ply);
    const bestLine = sanLineToUci(ply.fenBefore, analysis.evalBefore.pv);
    if (analysis.evalBefore.pv.length && bestLine.length !== analysis.evalBefore.pv.length) {
      return null;
    }
    const refLine = sanLineToUci(ply.fenAfter, analysis.evalAfter.pv);
    return {
      schemaVersion: 1,
      fenBefore: ply.fenBefore,
      playedMoveUci,
      bestMoveUci: bestLine[0],
      refutationUci: refLine[0],
      principalVariationUci: bestLine.length ? bestLine : undefined,
      options: { includeMotifOpportunities: true, includeCounterfactual: true },
    };
  } catch {
    return null;
  }
}
