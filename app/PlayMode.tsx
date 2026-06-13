// Play mode — the same perception + coaching suite as the analysis board, but for
// a LIVE game you play (hot-seat). Drag-and-drop OR click-to-move, full legality
// via chess.js, every mode-scoped overlay applied to the live position, a Facts
// inspect card for any square, and — once the engine is loaded — a per-move
// analysis (classification + What-Changed) plus the validated Control-Lens
// coaching line and optional written commentary.
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { Chess } from 'chess.js';
import { Board2D } from './Board2D';
import { ARROW, type Arrow } from './BoardArrows';
import { FactsPanel } from './FactsPanel';
import { computeLedMap, type ModeId } from '../engine/led';
import { MODES, LED_CSS } from './modes';
import { selectionArrows, lineArrows } from './annotate';
import { AnnotationLegend } from './AnnotationLegend';
import { analyzeMoveLive } from '../engine/analyze';
import { extractPlyFeatures, type PlyFeatures } from '../engine/features';
import { computeControlLens, type Verdict } from '../engine/control-lens';
import type { UciEngine } from '../engine/evaluation';
import type { InsightCandidate, MoveAnalysis, Square } from '../engine/types';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

type VerboseMove = { from: string; to: string; san: string; flags: string; promotion?: string };
type HistEntry = { san: string; fen: string; from: Square; to: Square };
const PROMO_PIECES = ['q', 'r', 'n', 'b'] as const;
const PROMO_GLYPH: Record<string, Record<string, string>> = {
  w: { q: '♕', r: '♖', n: '♘', b: '♗' },
  b: { q: '♛', r: '♜', n: '♞', b: '♝' },
};
const VERDICT_COLOR: Record<Verdict, string> = {
  satisfied: '#3f813f',
  accepted_tradeoff: '#3b7fe2',
  failed: '#e8923b',
  violated: '#e23b3b',
};

function legalMovesFrom(fen: string, sq: Square): VerboseMove[] {
  try {
    return new Chess(fen).moves({ square: sq as never, verbose: true }) as unknown as VerboseMove[];
  } catch {
    return [];
  }
}

export function PlayMode({
  engine,
  engineReady = false,
  narrateMove,
}: {
  engine?: UciEngine | null;
  engineReady?: boolean;
  narrateMove?: (a: MoveAnalysis, features: PlyFeatures) => Promise<string>;
}) {
  const [fen, setFen] = useState(START_FEN);
  const [selected, setSelected] = useState<Square | null>(null);
  const [history, setHistory] = useState<HistEntry[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [mode, setMode] = useState<ModeId>('legal');
  // Annotation toggles — the same controls as the analysis board.
  const [showThreats, setShowThreats] = useState(true);
  const [showAllThreats, setShowAllThreats] = useState(false);
  const [cascade, setCascade] = useState(true);
  const [followMove, setFollowMove] = useState(true);
  const [focused, setFocused] = useState<InsightCandidate | null>(null);

  // Live coaching state for the move just played.
  const [lastAnalysis, setLastAnalysis] = useState<MoveAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [coachText, setCoachText] = useState('');
  const [explaining, setExplaining] = useState(false);
  const [debug, setDebug] = useState(false); // dev overlay: artifact identity + eval status
  const analyzeIdRef = useRef(0); // cancels stale analyses when you move/undo fast

  const status = useMemo(() => {
    const c = new Chess(fen);
    const sideToMove = c.turn() === 'w' ? 'White' : 'Black';
    const winner = c.turn() === 'w' ? 'Black' : 'White';
    if (c.isCheckmate()) return { text: `Checkmate — ${winner} wins`, over: true, tone: 'var(--bad)' };
    if (c.isStalemate()) return { text: 'Stalemate — draw', over: true, tone: 'var(--text-soft)' };
    if (c.isInsufficientMaterial()) return { text: 'Draw — insufficient material', over: true, tone: 'var(--text-soft)' };
    if (c.isThreefoldRepetition()) return { text: 'Draw — threefold repetition', over: true, tone: 'var(--text-soft)' };
    if (c.isDraw()) return { text: 'Draw — fifty-move rule', over: true, tone: 'var(--text-soft)' };
    const check = c.inCheck() ? ' — check' : '';
    return { text: `${sideToMove} to move${check}`, over: false, tone: check ? '#b54708' : 'var(--text)' };
  }, [fen]);

  // Legal destinations of the picked-up piece — for click-to-move acceptance.
  const targets = useMemo(
    () => (selected ? legalMovesFrom(fen, selected).map((m) => m.to as Square) : []),
    [fen, selected],
  );

  // Gate the played-move analysis to the CURRENT board: a consumer must never render
  // an artifact computed for a different position. positionAfter is the artifact's
  // identity; it equals fen after a move and after an inspect-click, so this is a
  // defense-in-depth guard that fails safe if an async race ever desyncs them.
  const liveAnalysis = lastAnalysis && lastAnalysis.positionAfter === fen ? lastAnalysis : null;

  // The board overlay: the SAME mode-scoped lenses as the analysis view, applied
  // live to the current position. 'legal' doubles as the move-target hint; the
  // 'What Changed' lens uses the live MoveAnalysis of the move you just played.
  const ledMap = useMemo(
    () => computeLedMap(mode, { fen, selectedSquare: selected ?? undefined, analysis: liveAnalysis ?? undefined }),
    [mode, fen, selected, liveAnalysis],
  );

  // Validated coaching for the played move: hazard diff → control action.
  const featuresOfLast = useMemo(
    () =>
      liveAnalysis
        ? extractPlyFeatures(liveAnalysis.positionBefore, liveAnalysis.positionAfter, liveAnalysis.move, liveAnalysis)
        : null,
    [liveAnalysis],
  );
  const lens = useMemo(
    () => (liveAnalysis && featuresOfLast ? computeControlLens(featuresOfLast, liveAnalysis) : null),
    [liveAnalysis, featuresOfLast],
  );

  const last = history[history.length - 1];

  // The full annotation suite, live: focus mode spotlights one tactic; otherwise
  // the played-move arrow (follow move) + the selected piece's attack/defend/
  // cascade arrows + numbered threat lines from the move's analysis.
  const arrows = useMemo<Arrow[]>(() => {
    if (focused) return lineArrows(fen, focused, false);
    const out: Arrow[] = [];
    if (followMove && last) out.push({ from: last.from, to: last.to, color: ARROW.move, move: true });
    if (selected) out.push(...selectionArrows(fen, selected, cascade));
    if (liveAnalysis && liveAnalysis.rankedInsights.length) {
      const top = liveAnalysis.rankedInsights[0];
      const threats = showAllThreats
        ? liveAnalysis.rankedInsights.filter((i) => i.source === 'refutation' || i.source === 'available')
        : showThreats && top.source === 'refutation'
          ? [top]
          : [];
      for (const ins of threats) out.push(...lineArrows(fen, ins, ins !== top));
    }
    return out;
  }, [fen, selected, liveAnalysis, showThreats, showAllThreats, cascade, focused, followMove, last]);

  function applyMove(from: Square, to: Square, promotion?: string) {
    const before = fen;
    const c = new Chess(before);
    let m: VerboseMove | null = null;
    try {
      m = c.move({ from, to, promotion }) as unknown as VerboseMove;
    } catch {
      m = null;
    }
    if (!m) return;
    const san = m.san;
    setHistory((h) => [...h, { san, fen: c.fen(), from, to }]);
    setFen(c.fen());
    setSelected(followMove ? to : null); // "follow move" — broadcast the move just made
    setFocused(null);
    setPromo(null);
    setCoachText('');

    // Kick a live analysis of the move (free, local). Latest-wins via the seq ref.
    const id = ++analyzeIdRef.current;
    if (engine && engineReady) {
      setAnalyzing(true);
      setLastAnalysis(null);
      analyzeMoveLive(engine, before, san)
        .then((a) => {
          if (analyzeIdRef.current === id) {
            setLastAnalysis(a);
            setAnalyzing(false);
          }
        })
        .catch(() => {
          if (analyzeIdRef.current === id) setAnalyzing(false);
        });
    } else {
      setLastAnalysis(null);
      setAnalyzing(false);
    }
  }

  function tryMove(from: Square, to: Square) {
    if (status.over) return;
    const matches = legalMovesFrom(fen, from).filter((m) => m.to === to);
    if (!matches.length) return; // illegal — no state change
    if (matches.every((m) => m.promotion)) {
      setPromo({ from, to }); // pawn reaching the last rank — ask which piece
      return;
    }
    applyMove(from, to, matches[0].promotion);
  }

  function onSquareClick(sq: Square) {
    if (promo) return; // resolve the promotion choice first
    // If a side-to-move piece is up and you click a legal destination → move.
    if (!status.over && selected && targets.includes(sq)) {
      tryMove(selected, sq);
      return;
    }
    // Click the selection again to clear it.
    if (selected === sq) {
      setSelected(null);
      setFocused(null);
      return;
    }
    // Otherwise inspect ANY square on demand — your piece, the opponent's, or
    // empty. The Facts card + selection arrows + legal overlay populate for it.
    // Starting a new inspection drops any focused-insight spotlight (it was painting
    // a prior selection's tactic, not this square).
    setFocused(null);
    setSelected(sq);
  }

  function resetCoach() {
    analyzeIdRef.current++; // cancel any in-flight analysis
    setLastAnalysis(null);
    setAnalyzing(false);
    setCoachText('');
    setFocused(null);
  }

  function undo() {
    if (!history.length) return;
    const next = history.slice(0, -1);
    setHistory(next);
    setFen(next.length ? next[next.length - 1].fen : START_FEN);
    setSelected(null);
    setPromo(null);
    resetCoach();
  }

  function newGame() {
    setFen(START_FEN);
    setHistory([]);
    setSelected(null);
    setPromo(null);
    setMode('legal');
    resetCoach();
  }

  async function explain() {
    if (!narrateMove || !liveAnalysis || !featuresOfLast) return;
    setExplaining(true);
    setCoachText('');
    try {
      setCoachText(await narrateMove(liveAnalysis, featuresOfLast));
    } catch (e) {
      setCoachText(`Coach unavailable — ${String((e as Error)?.message ?? e)}`);
    } finally {
      setExplaining(false);
    }
  }

  const turn = new Chess(fen).turn(); // side to move — drives the turn plates + promo glyphs
  const topSide: 'w' | 'b' = flipped ? 'w' : 'b';
  const bottomSide: 'w' | 'b' = flipped ? 'b' : 'w';
  const rows: { n: number; white?: string; black?: string }[] = [];
  for (let i = 0; i < history.length; i += 2) {
    rows.push({ n: i / 2 + 1, white: history[i]?.san, black: history[i + 1]?.san });
  }

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {/* ── Board + controls ───────────────────────────────────────────── */}
      <div style={{ ...card, padding: 12, width: 'max-content' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 10 }}>
          <strong data-testid="play-status" style={{ fontSize: 15, color: status.tone }}>
            {status.text}
          </strong>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={btn} onClick={undo} disabled={!history.length}>
              Undo
            </button>
            <button style={btn} onClick={() => setFlipped((f) => !f)}>
              Flip
            </button>
            <button style={primaryBtn} onClick={newGame}>
              New game
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {MODES.map((m) => {
            const disabled = !!m.needsAnalysis && !lastAnalysis;
            return (
              <button
                key={m.id}
                disabled={disabled}
                onClick={() => setMode(m.id)}
                title={disabled ? 'Make a move with the engine loaded to populate this' : undefined}
                style={m.id === mode ? modeBtnActive : disabled ? modeBtnDisabled : modeBtn}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        <TurnPlate color={topSide} active={!status.over && turn === topSide} />

        <div style={{ position: 'relative', width: 'max-content' }}>
          <Board2D
            fen={fen}
            ledMap={ledMap}
            selected={selected ?? undefined}
            onSelect={onSquareClick}
            arrows={arrows}
            orientation={flipped ? 'black' : 'white'}
            draggable={!status.over}
            onPieceDrop={(from, to) => tryMove(from, to)}
          />
          {promo && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(16,24,40,0.55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 5,
              }}
            >
              <div style={{ ...card, padding: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-soft)', marginRight: 2 }}>Promote to</span>
                {PROMO_PIECES.map((p) => (
                  <button
                    key={p}
                    aria-label={`promote-${p}`}
                    onClick={() => applyMove(promo.from, promo.to, p)}
                    style={{
                      fontSize: 30,
                      lineHeight: 1,
                      width: 44,
                      height: 44,
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--card)',
                      cursor: 'pointer',
                    }}
                  >
                    {PROMO_GLYPH[turn][p]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <TurnPlate color={bottomSide} active={!status.over && turn === bottomSide} />

        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', margin: '8px 2px 0', fontSize: 12, color: 'var(--text-soft)' }}
        >
          {(MODES.find((m) => m.id === mode)?.legend ?? []).map((l) => (
            <span key={l.color + l.meaning} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: 3,
                  background: LED_CSS[l.color],
                  border: '1px solid rgba(0,0,0,0.12)',
                  display: 'inline-block',
                }}
              />
              {l.meaning}
            </span>
          ))}
        </div>
        <AnnotationLegend
          showThreats={showThreats}
          setShowThreats={setShowThreats}
          showAllThreats={showAllThreats}
          setShowAllThreats={setShowAllThreats}
          cascade={cascade}
          setCascade={setCascade}
          followMove={followMove}
          setFollowMove={setFollowMove}
          hasSelection={!!selected}
          onClear={() => setSelected(null)}
        />
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 2px 0' }}>
          Drag a piece or click from → to. Only legal moves are allowed.
          <label style={{ marginLeft: 10, cursor: 'pointer' }} title="dev overlay: artifact identity + eval status">
            <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} /> debug
          </label>
        </p>
      </div>

      {/* ── Right column: Facts · Coach · Moves ─────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: '1 1 280px', minWidth: 280, maxWidth: 360 }}>
        <div style={{ ...card, padding: 12 }}>
          <FactsPanel
            fen={fen}
            selected={selected ?? undefined}
            analysis={liveAnalysis ?? undefined}
            move={liveAnalysis?.move}
            focused={focused}
            onFocus={(ins) => setFocused((cur) => (cur === ins ? null : ins))}
          />
        </div>

        <div style={{ ...card, padding: 12 }}>
          <strong style={{ fontSize: 13, color: 'var(--text)' }}>Coach</strong>
          {!engineReady ? (
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
              Engine not loaded — inspect-only. The overlays and Facts still work.
            </p>
          ) : analyzing ? (
            <p style={{ fontSize: 13, color: 'var(--text-soft)', marginTop: 6 }}>Analyzing your move…</p>
          ) : lens ? (
            <div style={{ marginTop: 6 }}>
              <span
                style={{
                  display: 'inline-block',
                  padding: '1px 8px',
                  borderRadius: 10,
                  background: VERDICT_COLOR[lens.verdict],
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                {lens.verdict.replace(/_/g, ' ')}
              </span>
              <p style={{ fontSize: 13, color: 'var(--text)', margin: '4px 0 0', lineHeight: 1.5 }}>{lens.teachingLine}</p>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
              Make a move — I’ll explain what it controlled.
            </p>
          )}

          {narrateMove ? (
            <>
              <button
                style={{ ...btn, marginTop: 10 }}
                onClick={explain}
                disabled={!liveAnalysis || explaining}
              >
                {explaining ? 'Explaining…' : 'Explain this move'}
              </button>
              {coachText && (
                <p
                  style={{
                    fontSize: 13,
                    color: 'var(--text)',
                    marginTop: 8,
                    background: 'var(--track)',
                    padding: 8,
                    borderRadius: 6,
                    lineHeight: 1.5,
                  }}
                >
                  {coachText}
                </p>
              )}
            </>
          ) : (
            engineReady && (
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
                Add an OpenAI key (.env, server-side) for written commentary.
              </p>
            )
          )}
        </div>

        <div style={{ ...card, padding: 12 }}>
          <strong style={{ fontSize: 13, color: 'var(--text)' }}>Moves</strong>
          {rows.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>No moves yet — White to start.</p>
          ) : (
            <ol style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              {rows.map((r) => (
                <li key={r.n} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
                  <span style={{ color: 'var(--muted)', width: 24, textAlign: 'right' }}>{r.n}.</span>
                  <span style={{ width: 64 }}>{r.white}</span>
                  <span style={{ width: 64, color: 'var(--text)' }}>{r.black ?? ''}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {debug && (
          <div
            data-testid="debug-overlay"
            style={{
              ...card,
              padding: 10,
              fontSize: 11,
              fontFamily: 'ui-monospace, monospace',
              color: 'var(--text-soft)',
              wordBreak: 'break-all',
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: 'var(--text)' }}>debug</strong>
            <div>ply: {history.length} · sideToMove: {turn}</div>
            <div>selected: {selected ?? '—'} · focused: {focused ? focused.squares.join(',') : '—'}</div>
            <div>fen: {fen}</div>
            <div>analysis.positionId: {lastAnalysis?.positionId ?? '—'}</div>
            <div>
              positionAfter===fen: {lastAnalysis ? String(lastAnalysis.positionAfter === fen) : '—'} · live:{' '}
              {liveAnalysis ? 'yes' : 'no'}
            </div>
            <div>
              class: {lastAnalysis?.classification ?? '—'} · cpLoss:{' '}
              {lastAnalysis ? lastAnalysis.cpLoss.toFixed(2) : '—'}
            </div>
            <div>
              evalBefore: {lastAnalysis?.evalBefore.status ?? (lastAnalysis ? 'ok' : '—')}
              {lastAnalysis?.evalBefore.reason ? ` (${lastAnalysis.evalBefore.reason})` : ''} · evalAfter:{' '}
              {lastAnalysis?.evalAfter.status ?? (lastAnalysis ? 'ok' : '—')}
              {lastAnalysis?.evalAfter.reason ? ` (${lastAnalysis.evalAfter.reason})` : ''}
            </div>
            <div>coach verdict: {lens ? lens.verdict : '—'}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function TurnPlate({ color, active }: { color: 'w' | 'b'; active: boolean }) {
  return (
    <div
      data-testid={`turn-${color}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 9px',
        margin: '6px 0',
        width: 'max-content',
        borderRadius: 8,
        border: active ? '1px solid #1570ef' : '1px solid var(--border)',
        background: active ? '#eff6ff' : '#fff',
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: color === 'w' ? '#fff' : '#111',
          border: '1px solid #98a2b3',
          display: 'inline-block',
        }}
      />
      <strong style={{ fontSize: 13, color: 'var(--text)' }}>{color === 'w' ? 'White' : 'Black'}</strong>
      {active && <span style={{ fontSize: 11, color: 'var(--accent-light)', fontWeight: 600 }}>● to move</span>}
    </div>
  );
}

const card: CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
};
const btn: CSSProperties = {
  fontSize: 13,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--text)',
  cursor: 'pointer',
};
const primaryBtn: CSSProperties = {
  fontSize: 13,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid #1570ef',
  background: 'var(--accent-light)',
  color: '#fff',
  cursor: 'pointer',
};
const modeBtn: CSSProperties = {
  fontSize: 12,
  padding: '5px 9px',
  borderRadius: 7,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--text)',
  cursor: 'pointer',
};
const modeBtnActive: CSSProperties = {
  ...modeBtn,
  border: '1px solid #1570ef',
  background: '#eff6ff',
  color: 'var(--accent-light)',
  fontWeight: 600,
};
const modeBtnDisabled: CSSProperties = {
  ...modeBtn,
  opacity: 0.45,
  cursor: 'not-allowed',
};
