import { describe, expect, it } from 'vitest';
import allowedForkFixture from '../../../fixtures/teaching-facts/v1/allowed-fork.json';
import type { MoveAnalysis } from '../../types';
import {
  auditTeachingCorpus,
  buildAutomatedReview,
  buildReviewTemplate,
  extractAuditRows,
  type TeachingAuditRow,
} from '../audit';
import { buildTeachingRecord, type TeachingRecordV1 } from '../record';
import type { TeachingFactBundleV1 } from '../types';

const ANALYSIS = {
  positionBefore: allowedForkFixture.fenBefore,
  positionAfter: allowedForkFixture.played.fenAfter,
  move: 'Re1',
  classification: 'blunder',
  evalBefore: { cp: 20, depth: 14, pv: ['Kh1'] },
  evalAfter: { cp: 180, depth: 14, pv: ['Nf3+'] },
  cpLoss: 1.6,
  rankedInsights: [],
  topExplanation: 'Re1 allows a fork.',
} as unknown as MoveAnalysis;

function baseRecord(): TeachingRecordV1 {
  return buildTeachingRecord({
    gameKey: 'game-0',
    ply: 1,
    san: 'Re1',
    analysis: ANALYSIS,
    facts: allowedForkFixture as unknown as TeachingFactBundleV1,
  });
}

function rows(count: number): TeachingAuditRow[] {
  const base = baseRecord();
  return Array.from({ length: count }, (_, index) => {
    const record = structuredClone(base);
    record.gameKey = `game-${index}`;
    return {
      gameKey: record.gameKey,
      ply: record.ply,
      classification: record.classification,
      cpLoss: record.cpLoss,
      san: record.san,
      fenBefore: record.positionBefore,
      bestLine: record.bestLine,
      refutationLine: record.refutationLine,
      record,
      source: 'test',
    };
  });
}

describe('teaching promotion audit', () => {
  it('passes Gate 2 after 100 mistakes and every review slot is completed', () => {
    const corpus = rows(100);
    const review = buildAutomatedReview(corpus);

    const report = auditTeachingCorpus(corpus, review);
    expect(report.gates.gate2.status).toBe('pass');
    expect(report.gates.gate1.status).toBe('pass');
    expect(report.gates.gate3.status).toBe('pass');
    expect(report.gates.gate4.status).toBe('pass');
    expect(report.gates.gate5.status).toBe('pass');
    expect(report.counts.reviewedEvents).toBe(report.counts.emittedEvents);
  });

  it('does not treat 100 mistakes from fewer than 100 games as a 100-game replay', () => {
    const corpus = rows(100).map((row, index) => {
      const gameKey = `game-${index % 17}`;
      const record = structuredClone(row.record);
      if (record) {
        record.gameKey = gameKey;
        record.ply = index + 1;
      }
      return { ...row, gameKey, ply: index + 1, record };
    });
    const review = buildAutomatedReview(corpus);
    const report = auditTeachingCorpus(corpus, review);
    expect(report.counts.analyzedMistakes).toBe(100);
    expect(report.counts.replayedGames).toBe(17);
    expect(report.gates.gate2.status).toBe('fail');
  });

  it('fails stable output when the pinned corpus hash drifts', () => {
    const corpus = rows(2);
    const review = buildReviewTemplate(corpus);
    review.baselineCorpusHash = 'stale-hash';
    const report = auditTeachingCorpus(corpus, review);
    expect(report.gates.gate4.status).toBe('fail');
    expect(report.findings.map((finding) => finding.code)).toContain('snapshot_drift');
  });

  it('flags a punishment that does not match the refutation branch', () => {
    const corpus = rows(2);
    const event = corpus[0].record?.events[0];
    if (!event?.punishment) throw new Error('expected allowed-fork punishment');
    event.punishment.move = 'g5e4';
    const report = auditTeachingCorpus(corpus, buildReviewTemplate(corpus));
    expect(report.gates.gate3.status).toBe('fail');
    expect(report.findings.map((finding) => finding.code)).toContain('refutation_mismatch');
  });

  it('keeps analyzed mistakes without records in the false-negative review denominator', () => {
    const exportJson = {
      plies: [
        {
          ply: 7,
          analysis: { classification: 'mistake', cpLoss: 1.2 },
          teaching: { computed: false, reason: 'no_committed_record' },
        },
      ],
    };
    const extracted = extractAuditRows(exportJson, 'game.json');
    const review = buildReviewTemplate(extracted);
    expect(extracted).toHaveLength(1);
    expect(review.reviews).toEqual([
      expect.objectContaining({ ply: 7, falseNegativeTopics: null, events: [] }),
    ]);
  });
});
