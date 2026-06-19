# UI Aesthetics Audit

## Validated Findings

- The app previously had no CSS file.
- Global reset, tokens, and responsive grid CSS were injected from `App.tsx`.
- `PlayMode.tsx` depended on shared global classes while still carrying many
  inline style objects.
- The Play tab needed stronger grid bounds and panel overflow rules to prevent
  narrow-view collapse.

## Implemented Result

- Global CSS now lives in `app/styles/index.css`.
- `src/main.tsx` imports the stylesheet once.
- `App.tsx` no longer injects the global `<style>` block.
- Theme tokens now include a deep neutral page background, glass surfaces,
  Stockfish/CVS accent colors, transitions, shadows, and reduced-motion rules.
- `.cvs-workspace` and `.cvs-gif-capture` define responsive grid behavior with
  `minmax(0, ...)` constraints.
- Analyze shell responsibilities are split across `AppHeader`, `AppSourceBar`,
  `AnalysisBoardPanel`, `AnalysisMoveHistory`, and `VariationPreviewPanel`.
- Play responsibilities are split across board header/help, opponent and mode
  controls, turn plate, move history, commentary, debug, promotion, review, and
  export helpers.
- Analyze and Play layouts were manually checked at desktop and narrow
  viewports after the extraction.

## Design Direction

- Keep the chess board as the first visual priority.
- Use restrained premium dark styling: deep neutral base, controlled blue/violet
  engine accents, warm teaching accents, green/gold/red evaluation states.
- Use glass surfaces for panels, but avoid decoration that competes with board
  inspection.
- Animate interactions only when they improve clarity, and respect reduced
  motion.

## Ongoing Standard

- New layout rules belong in `app/styles/index.css`, not render-time style
  injection.
- Components may retain small value-dependent inline styles, but structural
  spacing, sizing, grid, and responsive behavior belong to named classes.
- Every UI change must preserve bounded board/panel tracks, internal scrolling,
  and readable sub-980px layouts.
