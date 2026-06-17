# UI Aesthetics Audit

## Validated Findings

- The app previously had no CSS file.
- Global reset, tokens, and responsive grid CSS were injected from `App.tsx`.
- `PlayMode.tsx` depended on shared global classes while still carrying many
  inline style objects.
- The Play tab needed stronger grid bounds and panel overflow rules to prevent
  narrow-view collapse.

## Implemented Baseline

- Global CSS now lives in `app/styles/index.css`.
- `src/main.tsx` imports the stylesheet once.
- `App.tsx` no longer injects the global `<style>` block.
- Theme tokens now include a deep neutral page background, glass surfaces,
  Stockfish/CVS accent colors, transitions, shadows, and reduced-motion rules.
- `.cvs-workspace` and `.cvs-gif-capture` define responsive grid behavior with
  `minmax(0, ...)` constraints.

## Design Direction

- Keep the chess board as the first visual priority.
- Use restrained premium dark styling: deep neutral base, controlled blue/violet
  engine accents, warm teaching accents, green/gold/red evaluation states.
- Use glass surfaces for panels, but avoid decoration that competes with board
  inspection.
- Animate interactions only when they improve clarity, and respect reduced
  motion.

## Next Extraction Targets

- Move source/import controls, mode controls, move strip/history, turn plate,
  game review, variation preview, and side panels into small components.
- Convert large inline layout objects into classes as components are extracted.
- Add responsive screenshots after PlayMode and App are thin enough to test
  without brittle layout coupling.

