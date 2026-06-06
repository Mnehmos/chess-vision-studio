import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import samplePgn from '../fixtures/sample-game.pgn?raw';
import { pliesFromPgn, type PlyRecord } from '../engine/position';
import { computeLedMap } from '../engine/led';
import { analyzeMoveLive } from '../engine/analyze';
import { buildRelationMap } from '../engine/relations';
import { UciEngine } from '../engine/evaluation';
import type { MoveAnalysis, Square } from '../engine/types';
import { tryCreateEngine } from './engine-browser';
import { MODES, LED_CSS } from './modes';
import { Board2D } from './Board2D';
import { ARROW, type Arrow } from './BoardArrows';
import { FactsPanel } from './FactsPanel';
import { LedPreview } from './LedPreview';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function App() {
  const [pgnText, setPgnText] = useState(samplePgn);
  const [plies, setPlies] = useState<PlyRecord[]>(() => safePlies(samplePgn));
  const [view, setView] = useState(0); // 0 = start; k = after move k
  const [modeId, setModeId] = useState(MODES[0].id);
  const [selected, setSelected] = useState<Square | undefined>(undefined);
  const [showThreats, setShowThreats] = useState(true);
  const [showAllThreats, setShowAllThreats] = useState(false);
  const [analyses, setAnalyses] = useState<Map<number, MoveAnalysis>>(new Map());
  const [engineState, setEngineState] = useState<'loading' | 'ready' | 'off'>('loading');
  const engineRef = useRef<UciEngine | null>(null);

  // Boot Stockfish (best-effort). Pure modes work regardless.
  useEffect(() => {
    let alive = true;
    tryCreateEngine().then((e) => {
      if (!alive) return;
      engineRef.current = e;
      setEngineState(e ? 'ready' : 'off');
    });
    return () => {
      alive = false;
      engineRef.current?.dispose();
    };
  }, []);

  const fen = view === 0 ? plies[0]?.fenBefore ?? START_FEN : plies[view - 1].fenAfter;
  const plyIndex = view - 1; // index into plies for the move that produced `fen`
  const analysis = view > 0 ? analyses.get(plyIndex) : undefined;
  const moveLabel = view > 0 ? `${plies[plyIndex].moveNumber}${plies[plyIndex].color === 'w' ? '.' : '...'} ${plies[plyIndex].san}` : undefined;

  // Lazily analyze the current ply when the engine is ready.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || view === 0 || analyses.has(plyIndex)) return;
    let alive = true;
    analyzeMoveLive(engine, plies[plyIndex].fenBefore, plies[plyIndex].san).then((a) => {
      if (alive) setAnalyses((prev) => new Map(prev).set(plyIndex, a));
    });
    return () => {
      alive = false;
    };
  }, [view, engineState, plyIndex, plies, analyses]);

  const ledMap = useMemo(
    () => computeLedMap(modeId, { fen, selectedSquare: selected, analysis }),
    [modeId, fen, selected, analysis],
  );

  // Annotation arrows:
  //   • selected piece — DEFENDERS (green in), ATTACKERS (red in), and the piece's
  //     OWN attacks raycast OUTWARD (magenta out)
  //   • threat lines — the top refutation's call-and-response sequence, or ALL of
  //     them, each numbered and colored by the moving side
  const arrows = useMemo<Arrow[]>(() => {
    const out: Arrow[] = [];
    if (selected) {
      const rel = buildRelationMap(fen);
      const selRel = rel.bySquare[selected];
      if (selRel) {
        const selColor = selRel.piece[0];
        const selId = selRel.piece + selected;
        for (const id of selRel.defendedBy)
          out.push({ from: id.slice(2) as Square, to: selected, color: ARROW.defend });
        for (const id of selRel.attackedBy)
          out.push({ from: id.slice(2) as Square, to: selected, color: ARROW.attack });
        // outgoing: raycast what the selected piece attacks (red, like all attacks)
        for (const sq of Object.keys(rel.bySquare)) {
          const r = rel.bySquare[sq];
          if (r.piece[0] !== selColor && r.attackedBy.includes(selId))
            out.push({ from: selected, to: sq as Square, color: ARROW.attack });
        }
      }
    }

    if (analysis && analysis.rankedInsights.length) {
      const top = analysis.rankedInsights[0];
      const threats = showAllThreats
        ? analysis.rankedInsights.filter((i) => i.source === 'refutation' || i.source === 'available')
        : showThreats && top.source === 'refutation'
          ? [top]
          : [];
      for (const ins of threats) {
        const line = ins.kind === 'motif' ? ins.line : [];
        if (line.length) {
          const c = new Chess(fen);
          line.slice(0, 6).forEach((san, i) => {
            let m: ReturnType<Chess['move']> | null = null;
            try {
              m = c.move(san);
            } catch {
              m = null;
            }
            if (m)
              out.push({
                from: m.from,
                to: m.to,
                color: ARROW.tactical, // orange — tactical candidate line
                label: String(i + 1), // numbered for call-and-response order
                dashed: ins !== top,
              });
          });
        } else {
          for (const [from, to] of ins.arrows)
            out.push({ from, to, color: ARROW.attack, dashed: ins !== top });
        }
      }
    }
    return out;
  }, [fen, selected, analysis, showThreats, showAllThreats]);

  // Keyboard navigation: ← → step, Home/End jump.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft') setView((v) => Math.max(0, v - 1));
      else if (e.key === 'ArrowRight') setView((v) => Math.min(plies.length, v + 1));
      else if (e.key === 'Home') setView(0);
      else if (e.key === 'End') setView(plies.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plies.length]);

  const loadPgn = () => {
    const p = safePlies(pgnText);
    if (p.length) {
      setPlies(p);
      setView(0);
      setSelected(undefined);
      setAnalyses(new Map());
    }
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 20, color: '#1a1a1a' }}>
      <style>{`@keyframes csvBlink{50%{opacity:0.1}}`}</style>
      <h1 style={{ margin: '0 0 4px' }}>Chess Vision Studio</h1>
      <div style={{ color: '#666', marginBottom: 12 }}>
        2D chess perception — relations · SEE · diff · saliency · validated motifs.{' '}
        <EngineBadge state={engineState} />
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left: board + nav */}
        <div>
          <ModeBar modeId={modeId} onPick={setModeId} engineReady={engineState === 'ready'} />
          <Board2D
            fen={fen}
            ledMap={ledMap}
            selected={selected}
            onSelect={setSelected}
            arrows={arrows}
          />
          <Nav view={view} total={plies.length} setView={setView} />
          <MoveStrip plies={plies} view={view} setView={setView} />
          <AnnotationLegend
            showThreats={showThreats}
            setShowThreats={setShowThreats}
            showAllThreats={showAllThreats}
            setShowAllThreats={setShowAllThreats}
            hasSelection={!!selected}
            onClear={() => setSelected(undefined)}
          />
          <Legend modeId={modeId} />
        </div>

        {/* Middle: facts */}
        <FactsPanel fen={fen} selected={selected} analysis={analysis} move={moveLabel} />

        {/* Right: LED twin + move list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <LedPreview ledMap={ledMap} />
          <MoveHistory plies={plies} view={view} setView={setView} analyses={analyses} />
        </div>
      </div>

      <details style={{ marginTop: 20 }}>
        <summary style={{ cursor: 'pointer' }}>Import PGN</summary>
        <textarea
          value={pgnText}
          onChange={(e) => setPgnText(e.target.value)}
          style={{ width: 480, height: 120, display: 'block', marginTop: 8 }}
        />
        <button onClick={loadPgn} style={{ marginTop: 6 }}>
          Load
        </button>
      </details>
    </div>
  );
}

function safePlies(pgn: string): PlyRecord[] {
  try {
    return pliesFromPgn(pgn);
  } catch {
    return [];
  }
}

function EngineBadge({ state }: { state: 'loading' | 'ready' | 'off' }) {
  const text = state === 'loading' ? 'engine: loading…' : state === 'ready' ? 'engine: ready' : 'engine: off (pure modes only)';
  const bg = state === 'ready' ? '#3fbf5f' : state === 'loading' ? '#e8923b' : '#999';
  return (
    <span style={{ background: bg, color: '#fff', padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>
      {text}
    </span>
  );
}

function ModeBar({
  modeId,
  onPick,
  engineReady,
}: {
  modeId: string;
  onPick: (id: (typeof MODES)[number]['id']) => void;
  engineReady: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8, maxWidth: 460 }}>
      {MODES.map((m) => {
        const disabled = m.needsAnalysis && !engineReady;
        return (
          <button
            key={m.id}
            onClick={() => onPick(m.id)}
            disabled={disabled}
            title={disabled ? 'needs the engine' : undefined}
            style={{
              padding: '4px 8px',
              fontSize: 13,
              border: modeId === m.id ? '2px solid #16a' : '1px solid #bbb',
              background: modeId === m.id ? '#dceaff' : '#fff',
              borderRadius: 4,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function Nav({ view, total, setView }: { view: number; total: number; setView: (n: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
      <button onClick={() => setView(0)} disabled={view === 0}>
        ⏮
      </button>
      <button onClick={() => setView(Math.max(0, view - 1))} disabled={view === 0}>
        ◀
      </button>
      <span style={{ minWidth: 90, textAlign: 'center' }}>
        ply {view} / {total}
      </span>
      <button onClick={() => setView(Math.min(total, view + 1))} disabled={view === total}>
        ▶
      </button>
      <button onClick={() => setView(total)} disabled={view === total}>
        ⏭
      </button>
    </div>
  );
}

function AnnotationLegend({
  showThreats,
  setShowThreats,
  showAllThreats,
  setShowAllThreats,
  hasSelection,
  onClear,
}: {
  showThreats: boolean;
  setShowThreats: (v: boolean) => void;
  showAllThreats: boolean;
  setShowAllThreats: (v: boolean) => void;
  hasSelection: boolean;
  onClear: () => void;
}) {
  const swatch = (color: string, label: string) => (
    <span style={{ marginRight: 12, whiteSpace: 'nowrap' }}>
      <span
        style={{
          display: 'inline-block',
          width: 14,
          height: 4,
          background: color,
          borderRadius: 2,
          marginRight: 4,
          verticalAlign: 'middle',
        }}
      />
      {label}
    </span>
  );
  return (
    <div style={{ marginTop: 8, fontSize: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
      <strong style={{ marginRight: 6 }}>Arrows:</strong>
      {swatch(ARROW.attack, 'attacks / threats')}
      {swatch(ARROW.defend, 'defends / protects')}
      {swatch(ARROW.tactical, 'tactical line (1·2·3)')}
      <label style={{ marginLeft: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={showThreats} onChange={(e) => setShowThreats(e.target.checked)} />{' '}
        threat line
      </label>
      <label style={{ marginLeft: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={showAllThreats}
          onChange={(e) => setShowAllThreats(e.target.checked)}
        />{' '}
        all threats
      </label>
      {hasSelection && (
        <button onClick={onClear} style={{ marginLeft: 6, fontSize: 11 }}>
          clear selection
        </button>
      )}
    </div>
  );
}

function Legend({ modeId }: { modeId: string }) {
  const mode = MODES.find((m) => m.id === modeId)!;
  return (
    <div style={{ marginTop: 10, fontSize: 12 }}>
      {mode.legend.map((l) => (
        <span key={l.color} style={{ marginRight: 12, whiteSpace: 'nowrap' }}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              background: LED_CSS[l.color],
              borderRadius: 2,
              marginRight: 4,
              verticalAlign: 'middle',
            }}
          />
          {l.meaning}
        </span>
      ))}
    </div>
  );
}

// Compact horizontal notation directly under the board (always visible).
function MoveStrip({
  plies,
  view,
  setView,
}: {
  plies: PlyRecord[];
  view: number;
  setView: (n: number) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [view]);
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        marginTop: 8,
        padding: '6px 4px',
        maxWidth: 8 * 56,
        background: '#f3f1ea',
        borderRadius: 6,
        fontSize: 13,
      }}
    >
      {plies.map((p, i) => {
        const current = view === i + 1;
        return (
          <span
            key={i}
            ref={current ? ref : undefined}
            onClick={() => setView(i + 1)}
            style={{
              cursor: 'pointer',
              padding: '2px 5px',
              borderRadius: 4,
              background: current ? '#16a' : 'transparent',
              color: current ? '#fff' : '#222',
              fontWeight: current ? 700 : 400,
            }}
          >
            {p.color === 'w' ? `${p.moveNumber}. ` : ''}
            {p.san}
          </span>
        );
      })}
    </div>
  );
}

// Grouped notation table (move # · White · Black), current ply highlighted and
// auto-scrolled into view as turns progress.
function MoveHistory({
  plies,
  view,
  setView,
  analyses,
}: {
  plies: PlyRecord[];
  view: number;
  setView: (n: number) => void;
  analyses: Map<number, MoveAnalysis>;
}) {
  const currentRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [view]);

  // group plies into full moves
  const rows: { no: number; w?: PlyRecord & { i: number }; b?: PlyRecord & { i: number } }[] = [];
  plies.forEach((p, i) => {
    const row = rows.find((r) => r.no === p.moveNumber) ?? { no: p.moveNumber };
    if (!rows.includes(row)) rows.push(row);
    if (p.color === 'w') row.w = { ...p, i };
    else row.b = { ...p, i };
  });

  const cell = (m?: PlyRecord & { i: number }) => {
    if (!m) return <td />;
    const a = analyses.get(m.i);
    const bad = a && (a.classification === 'blunder' || a.classification === 'mistake');
    const current = view === m.i + 1;
    return (
      <td
        onClick={() => setView(m.i + 1)}
        style={{
          cursor: 'pointer',
          padding: '1px 6px',
          borderRadius: 4,
          background: current ? '#16a' : 'transparent',
          color: current ? '#fff' : bad ? '#c01515' : '#222',
          fontWeight: current ? 700 : 400,
        }}
      >
        {m.san}
        {bad ? (a!.classification === 'blunder' ? ' ??' : ' ?!') : ''}
      </td>
    );
  };

  return (
    <div style={{ minWidth: 200 }}>
      <h4 style={{ margin: '0 0 4px' }}>Move history</h4>
      <div style={{ maxHeight: 360, overflowY: 'auto', fontSize: 13 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {rows.map((r) => {
              const isCurrentRow = view === (r.w?.i ?? -2) + 1 || view === (r.b?.i ?? -2) + 1;
              return (
                <tr key={r.no} ref={isCurrentRow ? currentRef : undefined}>
                  <td style={{ color: '#999', paddingRight: 6 }}>{r.no}.</td>
                  {cell(r.w)}
                  {cell(r.b)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>← → keys to step</div>
    </div>
  );
}
