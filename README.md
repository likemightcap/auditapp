# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

## Cape Cod ceilings

Choose **CAPE COD (VERTICAL)** or **CAPE COD (HORIZONTAL)** in a rectangle's
Ceiling Type menu. Vertical divides the footprint into left/center/right sections;
horizontal divides it into top/center/bottom sections. The center is flat at HIGH,
and the two outer sections slope evenly from HIGH at the dotted dividers to LOW
at the outside edges. HIGH must be at least LOW.

The center starts as close to 50% of the cross-section as whole-foot section
sizes allow. For example, an 18-foot span starts with 5-foot outer sections and
an 8-foot center. If fractional outer sections are unavoidable, the center
still starts at a whole-foot size. Existing saved divider positions are preserved.
All three sections remain at least 2 feet wide, requiring a minimum cross-section
of 6 feet. In focus mode, drag either divider to move both symmetrically in
1-foot increments. Arrow keys also move a focused divider. Movement is clamped
at the 2-foot limits, even when reaching a limit requires a fractional last step.
While dragging, live measurements show each outer section's edge-to-divider
distance and the center's divider-to-divider distance. Vertical ceilings show
section widths; horizontal ceilings show section heights. Measurements use
decimal feet (up to two decimal places) and disappear when the drag ends or is
canceled.
Rectangle resizing and orientation changes preserve the center proportion,
subject to those minimums. Cape Cod is available on rectangular footprints,
not polygonal bump-outs; attic floors keep their existing ceiling controls.

The full footprint counts toward area unless excluded/unconditioned. Volume is
`center area * HIGH + combined sloped area * (HIGH + LOW) / 2`.
Project calculations integrate the actual height in each footprint cell, so
overlapping rectangles retain the existing topmost-rectangle precedence.
Ceiling settings and divider proportions are saved with the rectangle and
included in JSON exports; the dotted dividers and ceiling annotations also
appear in PDF exports.

Run the ceiling geometry and project-metrics regression tests with `npm test`
(Node.js 22.18+ or 24+).

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
