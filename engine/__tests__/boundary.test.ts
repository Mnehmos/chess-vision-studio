import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const engineRoot = join(process.cwd(), 'engine');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...tsFiles(path));
    } else if (entry.isFile() && path.endsWith('.ts') && !path.endsWith('.test.ts')) {
      out.push(path);
    }
  }
  return out;
}

function rel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, '/');
}

describe('engine production boundary', () => {
  const files = tsFiles(engineRoot);

  it('does not import app modules', () => {
    const offenders = files.filter((file) => /\.\.\/app|from ['"][^'"]*app\//.test(readFileSync(file, 'utf8')));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('does not own browser fetch/storage side effects', () => {
    const browserApis = /\bfetch\s*\(|\b(window|document|localStorage|indexedDB)\s*\./;
    const offenders = files.filter((file) => browserApis.test(readFileSync(file, 'utf8')));
    expect(offenders.map(rel)).toEqual([]);
  });
});
