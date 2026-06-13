import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import {
  auditTeachingCorpus,
  buildAutomatedReview,
  buildReviewTemplate,
  extractAuditRows,
  renderTeachingAuditMarkdown,
  type TeachingAuditReviewFile,
} from '../engine/teaching/audit';

interface CliOptions {
  inputs: string[];
  review: string;
  json: string;
  markdown: string;
  autoReview: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const inputs: string[] = [];
  let review = 'arena/out/teaching-audit-review.json';
  let json = 'arena/out/teaching-audit-report.json';
  let markdown = 'arena/reports/teaching-promotion-audit.md';
  let autoReview = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) inputs.push(argv[++i]);
    else if (arg === '--review' && argv[i + 1]) review = argv[++i];
    else if (arg === '--json' && argv[i + 1]) json = argv[++i];
    else if (arg === '--markdown' && argv[i + 1]) markdown = argv[++i];
    else if (arg === '--auto-review') autoReview = true;
    else if (!arg.startsWith('--')) inputs.push(arg);
  }
  return { inputs, review, json, markdown, autoReview };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.inputs.length === 0) {
    throw new Error(
      'usage: npm run teaching:audit -- --input export.json [--input export2.json] [--review review.json]',
    );
  }

  const rows = options.inputs.flatMap((input) => {
    const path = resolve(input);
    return extractAuditRows(readJson(path), basename(path));
  });
  if (rows.length === 0) throw new Error('no analyzed teaching rows found in the supplied JSON');

  const reviewPath = resolve(options.review);
  const existing = existsSync(reviewPath)
    ? (readJson(reviewPath) as TeachingAuditReviewFile)
    : undefined;
  const review = options.autoReview
    ? buildAutomatedReview(rows, existing)
    : buildReviewTemplate(rows, existing);
  const report = auditTeachingCorpus(rows, review);

  writeJson(reviewPath, review);
  writeJson(resolve(options.json), report);
  const markdownPath = resolve(options.markdown);
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, renderTeachingAuditMarkdown(report), 'utf8');

  console.log(`teaching rows: ${report.counts.rows}`);
  console.log(`analyzed mistakes: ${report.counts.analyzedMistakes}`);
  console.log(`emitted events: ${report.counts.emittedEvents}`);
  console.log(`review template: ${reviewPath}`);
  console.log(`json report: ${resolve(options.json)}`);
  console.log(`markdown report: ${markdownPath}`);
  for (const [gate, result] of Object.entries(report.gates)) {
    console.log(`${gate}: ${result.status}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`teaching audit failed: ${String((error as Error)?.message ?? error)}`);
  process.exit(1);
}
