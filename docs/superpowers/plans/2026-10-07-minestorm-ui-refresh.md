# MineStorm UI Refresh Implementation Plan

> **For agentic workers:** Execute this plan inline, task by task, with tests before production changes. The user already approved execution with “go” (m00687).

**Goal:** Apply the approved 3D-inspired MineStorm UI redesign, simplify new-game configuration, and make the board/victory presentation scale and read clearly.

**Architecture:** Keep the existing no-dependency HTML/CSS/JavaScript application. Use small pure helpers for SVG markup and board cell sizing, keep gameplay rules unchanged except the requested size/bomb limits and density-only setup, and retain existing celebration/timer/capture modules.

**Tech Stack:** HTML, CSS, vanilla JavaScript, Node built-in test runner.

**Spec:** Approved in-chat design m00686; 3D direction m00670; preserve AI-bomb checkbox and behavior while removing explanatory copy per m00680.

## Global Constraints

- Square board side length is 10–99, controlled by one input; remove manual mine-count mode and use density only.
- Density slider remains 10–90%, displays the percentage and the actual generated odd mine count.
- Per-player bomb count is 0–99. Keep the “禁用 AI 使用炸弹” checkbox and behavior; remove its explanatory paragraph only.
- Keep the prior requirement that fireworks continue until a new game, while avoiding idle requestAnimationFrame loops and respecting reduced motion.
- Overall treatment uses dimensional light/shadow/bevels without tilting the board or adding WebGL/dependencies; preserve readable cells, accessibility, and red/blue team identity.
- Existing user changes are uncommitted; do not reset, stage, or commit unrelated work.

## File Map

- `index.html`: square-size/density controls, remove manual-count controls and technical help copy, relocate winner message into the board area, load new helpers.
- `js/game-settings.js`: enforce 10–99 dimensions and 0–99 bombs; keep odd-count density calculation.
- `js/ui.js`: settings synchronization, square board initialization, SVG rendering, responsive layout wiring, winner overlay behavior.
- `js/mine-icons.js`: pure SVG markup for neutral/captured mine emblems and red attack bombs.
- `js/board-layout.js`: pure cell-size calculation with no maximum ceiling and a usable minimum for scrollable oversized boards.
- `js/victory-celebration.js`: brighter, center-origin bursts; continue until stop/new game.
- `css/style.css`: 3D visual system, scrollable board viewport, gradient slider, centered glass winner card, responsive layout and reduced-motion behavior.
- Tests: extend `test/ai-settings.test.js`, `test/ui-enhancements-contract.test.js`, `test/ui-settings-contract.test.js`, and `test/victory-celebration.test.js`; add `test/mine-icons.test.js` and `test/board-layout.test.js`.

## Task 1: Simplify settings and enforce requested ranges

**Files:** `index.html`, `js/game-settings.js`, `js/ui.js`, `test/ai-settings.test.js`, `test/ui-enhancements-contract.test.js`, `test/ui-settings-contract.test.js`.

- [x] Add failing boundary tests: `normalizeBombCount(100) === 99`, `normalizeMineCount(9999, 99, 99) === 9799`, and auto density at 15×15/23% still resolves to 53 odd mines.
- [x] Add failing setup contracts requiring one square-size input (`min=10`, `max=99`), bomb max 99, a 10–90 range slider, live percentage/actual-count summary, and no `cfgH`, `cfgMines`, or mine-mode radios. Verify the AI-bomb checkbox remains while API/plugin and AI-bomb explanatory blocks are absent.
- [x] Run focused tests and confirm failures are caused by the old bounds/markup.
- [x] Update normalization, density summary synchronization, and new-game creation to use `size × size`; remove manual-mode UI/state. Keep the checkbox behavior but remove help copy and long API/plugin descriptions.
- [x] Run focused tests; verify 10, 99, 0, 99, 100, minimum/maximum odd mine counts, and density updates.

## Task 2: SVG emblems, red bomb inventory, and dimensional cell treatment

**Files:** `index.html`, `js/mine-icons.js`, `js/ui.js`, `css/style.css`, `test/mine-icons.test.js`, `test/ui-enhancements-contract.test.js`.

- [x] Add tests for SVG output from `MineIcons.mineSvg(owner, capturing)`, `MineIcons.bombSvg()`, and the neutral mine-counter emblem; assert the shield embeds the same existing HUD mine, adds only subtle 3D depth, and has no capture flag.
- [x] Run the tests and confirm the old capture SVG still includes a flag and does not embed the existing counter-mine graphic.
- [x] Implement compact inline SVGs: a neutral mine for the remaining-mine HUD, red/blue beveled shields with the exact existing counter-mine graphic inside, and a distinct vivid red bomb for attack inventory. Add a subtle drop shadow to the embedded mine, keep the capture pop animation, and preserve accessible hidden decoration.
- [x] Replace the board emoji/CSS-only bomb sphere with helper-produced SVGs; update raised/recessed cell, metal-edge, red-bomb, and button bevel styles without expensive per-cell filters.
- [x] Run icon, capture, inventory, and accessibility tests.

## Task 3: Responsive square-board sizing for 10–99

**Files:** `index.html`, `js/board-layout.js`, `js/ui.js`, `css/style.css`, `test/board-layout.test.js`, `test/ui-enhancements-contract.test.js`.

- [x] Add failing pure-layout tests: a large viewport can yield a cell size greater than 44px; a 99×99 board uses the 24px minimum and overflows into a scrollable board viewport; width/height calculations remain square.
- [x] Run tests and confirm the old 44px ceiling / missing helper causes failure.
- [x] Implement `MineBoardLayout.cellSize(width, height, availableWidth, availableHeight)` using actual available dimensions, cell gaps, and board padding; use no maximum size and a 24px usable minimum.
- [x] Add a scrollable `boardViewport`, center the board when it fits, wire both `ResizeObserver` and window resize, and anchor the winner overlay to the visible board area.
- [x] Run layout boundary and UI integration tests, including 10×10 and 99×99.
- [x] At compact width, keep the board viewport at a usable 220px minimum and allow document scrolling instead of shrinking the board to one row; verify 754×487 Edge rendering.

## Task 4: Centered victory overlay and visible continuous fireworks

**Files:** `index.html`, `js/victory-celebration.js`, `js/ui.js`, `css/style.css`, `test/victory-celebration.test.js`, `test/ui-enhancements-contract.test.js`.

- [x] Add failing celebration assertions that the initial burst is centered (not edge-origin), the winner card is in the board viewport with a light glass treatment and slow pulse, and the canvas is more visible while still allowing board review.
- [x] Run the relevant tests and confirm current edge origins/top-right markup/faint opacity fail.
- [x] Change burst origins to the screen center region and strengthen particle visibility. Keep recurring bursts active until the new-game `stop()` call; retain the idle-RAF optimization and reduced-motion behavior.
- [x] Style the winner/draw card at the visible board center with restrained blur, stable readable text, and a slow opacity/glow pulse; keep pointer events disabled so controls remain usable.
- [x] Run focused celebration/UI tests and confirm winner text persists through idle intervals and stops only on a new game.

## Task 5: Final regression and review

- [x] Run `node --test --test-reporter=tap` and `git diff --check`.
- [x] Run `node --check` on changed JavaScript files.
- [x] Inspect the complete diff and verify the AI-bomb checkbox behavior, odd mine count, timers, capture ceremony, keyboard/touch slider access, and reduced-motion behavior remain intact.
- [x] Report test results and browser-smoke evidence/limitations; verify captured-mine interaction at 15×15 and responsive board/event-loop behavior at 99×99 in Edge.

## Self-review

- Coverage: settings and odd-count rules (Task 1); faction shields embedding the existing counter mine with subtle depth and capture feedback (Task 2); 10–99 resizing plus compact-viewport page/board scrolling (Task 3); central persistent victory presentation and reduced motion (Task 4); integration/regression (Task 5).
- Scope: only existing UI/game-settings behavior requested by the user; no new gameplay modes, WebGL, or dependencies.
- Execution: inline in this session, as the user already approved implementation; preserve pre-existing uncommitted work and do not create commits.
