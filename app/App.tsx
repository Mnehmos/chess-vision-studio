import { useEffect, useMemo, useRef, useState } from 'react';
import samplePgn from '../fixtures/sample-game.pgn?raw';
import { pliesFromPgn, type PlyRecord } from '../engine/position';
import { computeLedMap } from '../engine/led';
import { analyzeMoveLive } from '../engine/analyze';
import { UciEngine } from '../engine/evaluation';
import type { MoveAnalysis, Square } from '../engine/types';
import { tryCreateEngine } from './engine-browser';
import { MODES, LED_CSS } from './modes';
import { Board2D } from './Board2D';
import { FactsPanel } from './FactsPanel';
import { LedPreview } from './LedPreview';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function App() {
  const [pgnText, setPgnText] = useState(samplePgn);
  const [plies, setPlies] = useState<PlyRecord[]>(() => safePlies(samplePgn));
  const [view, setView] = useState(0); // 0 = start; k = after move k
  const [modeId, setModeId] = useState(MODES[0].id);
  const [selected, setSelected] = useState<Square | undefined>(undefined);
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
          <Board2D fen={fen} ledMap={ledMap} selected={selected} onSelect={setSelected} />
          <Nav view={view} total={plies.length} setView={setView} />
          <Legend modeId={modeId} />
        </div>

        {/* Middle: facts */}
        <FactsPanel fen={fen} selected={selected} analysis={analysis} move={moveLabel} />

        {/* Right: LED twin + move list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <LedPreview ledMap={ledMap} />
          <MoveList plies={plies} view={view} setView={setView} analyses={analyses} />
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

function MoveList({
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
  return (
    <div style={{ maxHeight: 320, overflowY: 'auto', fontSize: 13, minWidth: 180 }}>
      <h4 style={{ margin: '0 0 4px' }}>Moves</h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        {plies.map((p, i) => {
          const a = analyses.get(i);
          const flag = a && (a.classification === 'blunder' || a.classification === 'mistake');
          return (
            <button
              key={i}
              onClick={() => setView(i + 1)}
              style={{
                padding: '1px 5px',
                fontSize: 12,
                border: view === i + 1 ? '2px solid #16a' : '1px solid #ddd',
                background: flag ? '#ffe0e0' : '#fff',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              {p.color === 'w' ? `${p.moveNumber}.` : ''}
              {p.san}
            </button>
          );
        })}
      </div>
    </div>
  );
}
