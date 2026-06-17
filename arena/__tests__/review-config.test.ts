import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../ooda';
import { DEFAULT_STOCKFISH_REVIEW_DEPTH } from '../review-config';
import { loadLichessConfig } from '../lichess/env';

describe('Stockfish review depth defaults', () => {
  it('uses the shared review depth for the main OODA loop', () => {
    expect(DEFAULT_CONFIG.reviewDepth).toBe(DEFAULT_STOCKFISH_REVIEW_DEPTH);
    expect(DEFAULT_STOCKFISH_REVIEW_DEPTH).toBe(24);
  });

  it('uses the shared review depth for Lichess review unless env overrides it', () => {
    const previous = process.env.LICHESS_REVIEW_DEPTH;
    process.env.LICHESS_REVIEW_DEPTH = '';
    try {
      expect(loadLichessConfig().reviewDepth).toBe(DEFAULT_STOCKFISH_REVIEW_DEPTH);
    } finally {
      if (previous === undefined) delete process.env.LICHESS_REVIEW_DEPTH;
      else process.env.LICHESS_REVIEW_DEPTH = previous;
    }
  });
});

