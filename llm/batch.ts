// Batch narration — narrate many plies concurrently (bounded). This is the
// "batch calls from each ply": each ply's validated MoveAnalysis becomes one
// clamped LLM call; we run up to `concurrency` of them at a time.
import type { MoveAnalysis } from '../engine/types';
import type { ChatClient } from './openai';
import { narrate } from './narrate';

export interface NarratedPly {
  ply: number;
  move: string;
  classification: string;
  cpLoss: number;
  topExplanation: string; // the deterministic engine narration
  narration: string; // the LLM's clamped prose
  error?: string;
}

export interface PlyInput {
  ply: number;
  analysis: MoveAnalysis;
}

export async function batchNarrate(
  client: ChatClient,
  items: PlyInput[],
  concurrency = 4,
  onProgress?: (done: number, total: number) => void,
): Promise<NarratedPly[]> {
  const results: NarratedPly[] = new Array(items.length);
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const { ply, analysis } = items[i];
      const row: NarratedPly = {
        ply,
        move: analysis.move,
        classification: analysis.classification,
        cpLoss: analysis.cpLoss,
        topExplanation: analysis.topExplanation,
        narration: '',
      };
      try {
        row.narration = await narrate(client, analysis);
      } catch (e) {
        row.error = (e as Error).message;
      }
      results[i] = row;
      onProgress?.(++done, items.length);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  return results;
}
