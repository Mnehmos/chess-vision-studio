
export function AnnotationCommandList() {
  return (
    <div
      style={{
        background: 'var(--card, #1c1916)',
        border: '1px solid var(--border, #322d28)',
        borderRadius: '8px',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        width: '180px',
        boxSizing: 'border-box',
        fontSize: '12px',
        color: 'var(--text-soft, #cfc8bf)',
        fontFamily: "'Inter', system-ui, sans-serif",
        flexShrink: 0,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      }}
      className="cvsControlsLegend"
    >
      <h4
        style={{
          margin: 0,
          fontSize: '13px',
          color: 'var(--accent-light, #d4956a)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          borderBottom: '1px solid var(--border, #322d28)',
          paddingBottom: '8px',
        }}
      >
        Legend & Keys
      </h4>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <strong style={{ color: 'var(--text, #ece7e1)', display: 'block', marginBottom: '2px' }}>Right-Drag</strong>
          Draw sequential prediction arrows (White / Black)
        </div>
        <div>
          <strong style={{ color: 'var(--text, #ece7e1)', display: 'block', marginBottom: '2px' }}>Right-Click Arrow</strong>
          Delete that arrow and all subsequent steps
        </div>
        <div>
          <strong style={{ color: 'var(--text, #ece7e1)', display: 'block', marginBottom: '2px' }}>Left-Click/Drag</strong>
          Make legal move or inspect square facts
        </div>
        <div>
          <strong style={{ color: 'var(--text, #ece7e1)', display: 'block', marginBottom: '2px' }}>Pin / Preview</strong>
          Pin card / preview prediction on board
        </div>
        <div>
          <strong style={{ color: 'var(--text, #ece7e1)', display: 'block', marginBottom: '2px' }}>Reveal Analysis</strong>
          Show move evaluations and principal variations
        </div>
        
        <div style={{ borderTop: '1px solid var(--border, #322d28)', paddingTop: '10px', marginTop: '4px' }}>
          <span style={{ color: 'var(--accent-light, #d4956a)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
            Keyboard Shortcuts
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Game Move</span>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>← / →</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Jump Start/End</span>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>Home / End</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Exit Preview</span>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>Esc</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
