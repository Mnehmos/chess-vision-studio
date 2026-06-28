/**
 * PR-00 protocol capture — invokes the CVS Rust `analyze` binary in `--serve`
 * mode and records one golden fixture per wire response shape. This script does
 * NOT define the protocol; it photographs whatever the committed binary emits so
 * the TypeScript contract tests can fail loudly if a field ever disappears or
 * changes type (AnalysisFrameV2 plan §6 → PR-00).
 *
 * The binary is run with the DEFAULT evaluator (no --base/--rung2/--nnue) so the
 * capture is reproducible from a clean checkout without any trained-model files.
 * Production loads trained weights; that changes numeric values, NOT the schema.
 *
 * Usage:
 *   npx vite-node arena/capture-cvs-protocol.ts -- \
 *     --exe ../chess-vision-studio-rust-engine/target/release/analyze.exe \
 *     --depth 12 --out fixtures/cvs-engine
 *
 * Each serve request is a single stdin line; the binary replies with exactly one
 * JSON line. We send sequentially (request → await one line → next) because the
 * serve loop is strictly serial.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Args {
  exe: string;
  depth: number;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const platformBin = process.platform === 'win32' ? 'analyze.exe' : 'analyze';
  return {
    exe:
      get('--exe') ??
      process.env.CVS_RUST_EXE ??
      `../chess-vision-studio-rust-engine/target/release/${platformBin}`,
    depth: Number(get('--depth') ?? 12),
    out: get('--out') ?? 'fixtures/cvs-engine',
  };
}

/** A serial request/response client over the serve-mode subprocess. */
function createServeClient(exe: string, depth: number) {
  const child = spawn(exe, ['--serve', '--depth', String(depth)], { stdio: 'pipe' });
  const rl = createInterface({ input: child.stdout });
  const queue: Array<(line: string) => void> = [];
  const stderr: string[] = [];

  rl.on('line', (line) => {
    const resolveLine = queue.shift();
    if (resolveLine) resolveLine(line);
  });
  child.stderr.on('data', (d) => stderr.push(String(d)));
  child.on('error', (e) => {
    throw new Error(`failed to spawn ${exe}: ${e.message}`);
  });

  const request = (line: string, timeoutMs = 30_000): Promise<string> =>
    new Promise((resolveLine, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`serve request timed out: ${line.slice(0, 80)}`));
      }, timeoutMs);
      queue.push((out) => {
        clearTimeout(timer);
        resolveLine(out);
      });
      child.stdin.write(`${line}\n`);
    });

  const close = () => {
    try {
      child.stdin.write('quit\n');
      child.kill();
      rl.close();
    } catch {
      /* already gone */
    }
  };

  return { request, close, stderr };
}

/**
 * Replace wall-clock nondeterminism so fixtures are byte-stable across runs.
 * Only `timeMs` (top-level mirror + telemetry.timeMs) is non-reproducible at a
 * fixed depth on a single thread; everything else is deterministic for a given
 * binary build. The time-budgeted `go` response is the exception: its depth /
 * nodes vary by machine, so its fixture is schema-authoritative, not value-stable
 * (the contract test asserts shape only for it).
 */
function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = k === 'timeMs' ? 0 : sanitize(v);
    }
    return out;
  }
  return value;
}

function parseLine(label: string, line: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`${label}: binary returned non-JSON output: ${line.slice(0, 200)}`);
  }
  if (parsed && typeof parsed === 'object' && 'error' in parsed) {
    throw new Error(`${label}: binary returned error: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

// Positions chosen for clarity, speed, and rich-but-stable output.
const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const OPENING = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'; // 1.e4 e5 2.Nf3 Nc6
// Allowed-fork study (matches the rust facts golden corpus): Ra1-e1 walks the
// rook onto Ng5-f3+'s second fork target; g1h1 dodges; g5f3 is the refutation.
const FORK_FEN = '6k1/8/8/6n1/8/8/8/R5K1 w - - 0 1';
// Kiwipete — a busy position that activates several CVS-NNUE registry features
// (king-zone pressure, king shield, hanging material, mobility buckets), so the
// `cvs` fixture exercises non-empty activeIds / activeNames arrays.
const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

interface Capture {
  file: string;
  label: string;
  line: string;
}

const captures: Capture[] = [
  { file: 'search-v1.json', label: 'normal search (bare FEN → analyze_one shape)', line: OPENING },
  {
    file: 'search-fixedtime-v1.json',
    label: 'fixed-time search (text `go <ms> <fen>` → go shape)',
    line: `go 200 ${STARTPOS}`,
  },
  {
    file: 'search-forced-v1.json',
    label: 'forced-move search (JSON forcedMoveUci → search_pos shape)',
    line: JSON.stringify({ cmd: 'analyze', fen: STARTPOS, forcedMoveUci: 'e2e4' }),
  },
  {
    file: 'search-history-v1.json',
    label: 'history-aware search (JSON initialFen + moves → search_pos shape)',
    line: JSON.stringify({
      cmd: 'analyze',
      initialFen: 'startpos',
      moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
    }),
  },
  {
    file: 'eval-v1.json',
    label: 'static eval (text `eval <fen>`)',
    line: `eval ${STARTPOS}`,
  },
  {
    file: 'cvs-features-v1.json',
    label: 'CVS feature registry dump (text `cvs <fen>`)',
    line: `cvs ${KIWIPETE}`,
  },
  {
    file: 'facts-v1.json',
    label: 'teaching facts with counterfactuals (JSON cmd:facts)',
    line: JSON.stringify({
      cmd: 'facts',
      schemaVersion: 1,
      fenBefore: FORK_FEN,
      playedMoveUci: 'a1e1',
      bestMoveUci: 'g1h1',
      refutationUci: 'g5f3',
      options: { includeMotifOpportunities: true, includeCounterfactual: true },
    }),
  },
  {
    file: 'identity-v1.json',
    label: 'engine identity + search options (JSON cmd:identity)',
    line: JSON.stringify({ cmd: 'identity' }),
  },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  console.log(`exe=${args.exe} depth=${args.depth} out=${outDir}`);

  const client = createServeClient(args.exe, args.depth);
  try {
    for (const cap of captures) {
      const raw = await client.request(cap.line);
      const parsed = parseLine(cap.label, raw);
      const clean = sanitize(parsed);
      const dest = resolve(outDir, cap.file);
      writeFileSync(dest, `${JSON.stringify(clean, null, 2)}\n`);
      console.log(`  ✓ ${cap.file}  (${cap.label})`);
    }
  } catch (e) {
    console.error('CAPTURE FAILED:', (e as Error).message);
    if (client.stderr.length) console.error('binary stderr:', client.stderr.join(''));
    process.exitCode = 1;
  } finally {
    client.close();
  }
}

void main();
