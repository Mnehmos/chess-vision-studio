// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import allowedFork from '../fixtures/teaching-facts/v1/allowed-fork.json';
import type { TeachingFactBundleV1 } from '../engine/teaching/types';
import { TeachingFactsDebugPanel } from './TeachingFactsDebugPanel';

describe('TeachingFactsDebugPanel', () => {
  it('renders the raw Rust response behind a developer disclosure', () => {
    const { getByText, container } = render(
      <TeachingFactsDebugPanel
        request={{ schemaVersion: 1, fenBefore: allowedFork.fenBefore, playedMoveUci: 'e2e4' }}
        facts={allowedFork as TeachingFactBundleV1}
        busy={false}
        error=""
      />,
    );
    expect(getByText(/Teaching facts JSON/)).toBeTruthy();
    expect(container.querySelector('pre')?.textContent).toContain('factsRegistryVersion');
  });
});
