# MineStorm Shared AI Planner Implementation Plan

> **For agentic workers:** This plan is being executed inline in the current session. Tasks 1–7 record the completed shared-planner baseline. The approved design update supersedes their old “remove enhanced AI/BombBest” decisions; execute Tasks 8 onward in order, use TDD, prove each RED for the intended reason, and run each focused GREEN before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved probability and bomb-policy update to the shared MineStorm AI, restore opt-in engine-side Invincible BombBest targeting, enforce hidden-cell bomb centers for every player, and add the human airplane bomb cursor.

**Architecture:** Keep the immutable public-information planner as the default AI input and change its `freeMineProbability` estimate to the approved sum-of-component-minimum formula. Simple and Medium use their specified bomb timing/target functions; Invincible may request a hidden-state BombBest only through a default-on UI option and a guarded core path, while its plugin still receives no Game or mine-map reference. Enforce center legality in `Game.bomb()` and the AI decision guard; render the human bomb cursor as a one-cell SVG overlay while preserving the clipped `5×5` preview.

**Tech Stack:** Static HTML/CSS/vanilla JavaScript; Node.js built-in `node:test`; Playwright CLI headed Microsoft Edge for visual smoke checks; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-06-minestorm-shared-ai-planner-design.md` and `docs/superpowers/specs/2026-10-06-minestorm-ai-bomb-policy-design-update.md`

## Global Constraints

- `freeMineProbability = clamp((remainMines - sum(minMines(component) for each frontier component)) / freeCells.length, 0, 1)`; use `null` when there are no `freeCells`. This user-defined estimate is not an equal-weight global marginal.
- Ordinary AI analysis, normal coordinate choices, hints, and fallback decisions use only public information; plugins never receive `Game`, `Game.mines`, or a hidden-cell query API.
- The only hidden-map decision path is an explicitly authorized Invincible `{type:'bomb-auto'}` request resolved in the engine when the default-on enhanced option is enabled. If disabled, Invincible retains coordinate-only public strategy; `cfgDisableAiBombs` disables both AI bomb paths.
- Every bomb center, human or AI, coordinate or automatic, must be an unrevealed cell. Rejection must not consume a bomb or reveal cells. AI invalid decisions reuse the existing “AI 走昏招了！” notification and fallback.
- The blast is a centered `5×5` square (horizontal and vertical radius 2), clipped at board edges; do not change board dimensions, `makeMap`, or secure RNG.
- Simple bombs whenever it is trailing and `canBomb`; choose a legal hidden center maximizing hidden cells in the clipped blast. Medium bombs only when trailing by at least 5; choose a legal hidden center maximizing summed hidden-cell probabilities. Preserve their ordinary open-move rules.
- Invincible may use BombBest for an immediate win; otherwise automatic targeting requires trailing by at least 3 and must not increase `knownComponentCount`; choose the most actual hits among qualifying hidden centers, else use its public coordinate policy.
- Bomb-mode human cursor is an airplane SVG centered on the hovered target cell and limited to one cell; keep the `5×5` blast preview. User confirmed the probability-hint/cheat report appears fixed; do not modify that path.
- Keep plugin contract `makeDecision(view)`, lazy-load only the selected AI, preserve immutable shared analysis, and add no dependency or persisted AI state. At approximate quality expose no certain mines/safes.
- Run focused `node --test` files after each task and `node --test test/*.test.js` at the end.

## File Map

- `js/ai-planner.js`: update `freeMineProbability`; expose bomb-center candidates only where the center itself is unrevealed; retain immutable public analysis and ordinary expected yields.
- `js/core.js`: enforce hidden-center legality; restore guarded `Game.bombBest()` for automatic targeting only; calculate `knownComponentCount` and preserve fixed blast geometry.
- `js/ai-decision.js`: accept authorized Invincible `bomb-auto` plus validated coordinate fallback; reject out-of-bounds or revealed bomb centers.
- `plugin/ai-heuristic.js`: Simple `canBomb` timing and max-hidden-cell bomb center; preserve its ordinary move policy.
- `plugin/ai-global-probability.js`: Medium ≥5-point deficit gate and max summed-probability legal center; preserve ordinary move policy.
- `plugin/ai-constraint-probability.js`: use `freeMineProbability`; request auto-target only under the approved Invincible gate and retain coordinate fallback.
- `plugin/ai-config.js`: describe enhanced BombBest behavior and the public-only ordinary policy accurately.
- `js/ui.js`: restore default-on enhanced setting wiring; revalidate authorization before auto-target; reuse existing invalid-AI warning/fallback; explain illegal human center; render hovered one-cell airplane icon.
- `index.html`, `css/style.css`: restore enhanced-AI checkbox/help and define the one-cell airplane cursor without changing the fixed blast preview.
- `test/ai-planner.test.js`: minimum frontier-mine formula, no-free/cap/contradiction behavior, and hidden-center candidate classification.
- `test/strong-plugin.test.js`, `test/ai-edge-avoidance.test.js`: Simple/Medium bomb timing and target objectives; Invincible automatic versus coordinate policy.
- `test/bomb-area.test.js`, `test/ai-decision.test.js`: global center validation, no-spend/no-reveal rejection, and existing AI invalid-move behavior.
- `test/ui-settings-contract.test.js`, `test/plugin-registry.test.js`: default-on option, authorized auto dispatch/fallback, public plugin boundary, and cursor/help contract.

---

### Task 1: Make bomb geometry fixed at 5×5

**Files:**
- Modify: `js/core.js`
- Modify: `js/ui.js`
- Modify: `test/bomb-area.test.js`
- Modify: `test/ui-settings-contract.test.js`

**Interfaces:**
- Keep `Game.bombAreaCells(x, y)` as the single geometry function used by human preview and bomb execution.
- `Game.bombRadiusH` and `Game.bombRadiusV` are both always `2`; expose those public constants through `view` for plugin compatibility.
- Board widths/heights remain adjustable (current UI range 7–35); only the range below 5 cells is clipped by board boundaries.

- [x] **Step 1: Add failing fixed-geometry tests**

Replace dimension-derived assumptions in `test/bomb-area.test.js` with tests asserting:

```js
test('bomb blast remains 5x5 on boards with different dimensions', () => {
  for (const [width, height] of [[7, 7], [15, 9], [35, 35]]) {
    const board = game(width, height);
    assert.equal(board.bombRadiusH, 2);
    assert.equal(board.bombRadiusV, 2);
    const area = board.bombAreaCells(3, 3);
    assert.equal(area.length, 25);
  }
});

test('bomb blast clips a fixed 5x5 footprint at edges', () => {
  const board = game(7, 9);
  assert.deepEqual(Array.from(board.bombAreaCells(0, 0)), [0, 1, 2, 7, 8, 9, 14, 15, 16]);
});
```

Use a center with at least two cells of margin for full-area assertions. Add a narrow-board case proving clipping without changing radii.

- [x] **Step 2: Run focused tests and verify the expected RED**

Run: `node --test test/bomb-area.test.js`
Expected: the new radius assertions fail on at least one non-14/15 dimension because the current constructor uses `Math.floor(width / 7)` and `Math.floor(height / 7)`.

- [x] **Step 3: Implement fixed radii and fixed-size UI copy**

Set `this.bombRadiusH = 2; this.bombRadiusV = 2;` in `Game` instead of deriving from `w`/`h`. Leave `bombAreaCells` clipping logic intact. Update `updateHUD()` in `js/ui.js` and visible UI help so the normal status clearly reports `5×5` and the active guide reports `5×5（边缘会裁切）`; do not calculate displayed footprint from board dimensions.

- [x] **Step 4: Verify RED-to-GREEN**

Run: `node --test test/bomb-area.test.js test/ui-settings-contract.test.js`
Expected: fixed geometry, actual revealed cells, preview contract, and UI text tests pass.

### Task 2: Add the shared public-information probability planner

**Files:**
- Create: `js/ai-planner.js`
- Create: `test/ai-planner.test.js`
- Modify: `index.html`

**Interfaces:**

```js
window.MineAIPlanner.analyze(publicView, options = {})
  -> frozen Analysis

Analysis = {
  quality: 'exact' | 'approximate',
  frontierCells: frozen number[],
  freeCells: frozen number[],
  certainMines: frozen number[],
  certainSafes: frozen number[],
  freeMineProbability: number | null,
  mineProbabilityAt(x, y): number | undefined,
  hiddenCells: frozen number[],
  error?: string
}
```

`publicView` is a copied object with integer `width`, `height`, `mineCount`, `remainMines`, and a frozen copied-cell lookup; planner code never receives `Game` or a mine array. `options.maxSearchNodes` defaults to `250000` and exists to make the bounded-enumeration limit testable. Invalid dimensions, counts, or visible values throw `RangeError`; contradictions, no globally valid configurations, or search-cap exhaustion return a complete uniform `approximate` analysis with empty certainty sets and an error reason.

- [x] **Step 1: Write small-board exact-oracle and classification tests**

Create fixtures from `cellAt` values and a brute-force test helper that enumerates hidden mine assignments with exactly `remainMines`, rejects assignments violating every revealed clue (including zero), then computes each hidden cell's marginal. Assert planner marginals match the oracle on at least two small constrained boards, including two disconnected clue clusters plus free cells. Assert all hidden cells appear exactly once in frontier/free and every hidden cell has a probability.

- [x] **Step 2: Add tests for proof quality, contradiction and immutability**

Assert `certainMines`/`certainSafes` equal exact 1/0 marginals; a zero-neighbor clue with nonzero value and an impossible global mine total produce `quality: 'approximate'`, empty certainty sets, finite `[0,1]` values covering every hidden cell, and `error`. Force `maxSearchNodes: 0` to cover cap behavior. Assert mutating exposed arrays is impossible and no mutable `Map` or input view reference is exposed.

- [x] **Step 3: Run planner tests and verify the expected RED**

Run: `node --test test/ai-planner.test.js`
Expected: module/API is missing, so tests fail because `MineAIPlanner.analyze` is unavailable.

- [x] **Step 4: Implement constraint analysis and global equal-weight conditioning**

In `js/ai-planner.js`, copy/validate visible cells; define hidden as `-2`, revealed mine as `-1`, clue as `0..8`; identify frontier by adjacency to any revealed number including zero. Subtract each revealed mine from neighboring clue needs; reject zero-unknown contradictions. Propagate forced safe/mine cells only as internal solver reductions, enumerate each connected frontier cluster into per-cell mine-count histograms and per-cell mine strata, and globally combine cluster histograms with free-cell binomial coefficients under `remainMines`. Use exact `BigInt` assignment counts and convolution to avoid overflow and preserve exact certainty comparisons. Count all valid configurations equally; do not collapse cross-cluster weights with `max`.

- [x] **Step 5: Implement explicit fallback and freeze the public result**

If there are no satisfying configurations or the search cap is reached, assign the legal global baseline `remainMines / hiddenCells.length` to every hidden cell, clamped only after validating legal input; return `quality: 'approximate'`, `certainMines: []`, and `certainSafes: []`. Freeze all arrays and the analysis object; close over private probability storage behind `mineProbabilityAt(x, y)`. Return `freeMineProbability: null` when `freeCells` is empty.

- [x] **Step 6: Run RED-to-GREEN and load planner before UI**

Run: `node --test test/ai-planner.test.js`; then add `<script src="js/ai-planner.js"></script>` after `js/core.js` and before `js/ui.js` in `index.html`; run the planner tests again.
Expected: all exact-oracle, fallback, classification and immutability cases pass.

### Task 3: Convert the three AI policies to shared analysis

**Files:**
- Modify: `plugin/ai-heuristic.js`
- Modify: `plugin/ai-global-probability.js`
- Modify: `plugin/ai-constraint-probability.js`
- Modify: `test/strong-plugin.test.js`
- Modify: `test/ai-edge-avoidance.test.js`

**Interfaces:**
- Keep all registered IDs and `makeDecision(view)` entry points unchanged.
- Each AI reads only `view.analysis.mineProbabilityAt(x, y)`, the immutable `frontierCells`, `freeCells`, and certainty arrays plus existing public score/bomb fields.
- Simple and Medium retain their pre-change action-selection policies; remove their local probability inference/solvers. Invincible uses the exact policy order in spec sections 5–6.
- Any injected tie-break function used by tests is bounded: `randomIndex(n)` returns `[0,n)`; production uses `MineCore.randInt(n)`.

- [x] **Step 1: Update policy fixtures and add behavior tests before changing plugins**

Update test views to carry a frozen `analysis` fixture. For Invincible add tests for (a) exact certain mine before other choices, (b) approximate estimate `1` not treated as certain, (c) `max(frontier) >= freeMineProbability` selects frontier, (d) any strict `<` selects only free even when nearly equal, (e) no-free and no-frontier cases, (f) equal-probability random tie, and (g) late-game revealed-mine neighbor preference without overriding exact certain mines. Add fixed `5×5` bomb-yield fixtures at center and board edge.

- [x] **Step 2: Run focused tests and verify the expected RED**

Run: `node --test test/strong-plugin.test.js test/ai-edge-avoidance.test.js`
Expected: the old plugin ignores the new analysis fixture and fails the requested strategy outcomes.

- [x] **Step 3: Migrate Simple and Medium to the shared probability accessor**

For Simple, remove `visProb`/`hiddenValue` probability propagation and read cell probability from `analysis`; preserve its existing local candidate ranking, tie preference, interior handling, certain-mine preference and bomb-use thresholds. For Medium, remove `computeProbabilities` and its global enumeration helpers; preserve its existing highest-probability/interior-first action rule, bomb-use threshold and fallback ordering while reading probabilities from `analysis`. Do not add a new tier rule or make their decisions invoke the planner themselves. Remove `MineCore.computeProbabilities` plugin side effect as planner consumers migrate.

- [x] **Step 4: Implement Invincible frontier/free, endgame and fixed-blast bomb policy**

Select from `certainMines` only when `analysis.quality === 'exact'`. Otherwise compare `max(frontier probabilities)` against the shared `freeMineProbability` with a strict `<` branch and choose through bounded uniform tie selection. Apply the approved endgame gate (`abs(score - oppScore) <= 2` and `winNeed - max(score, oppScore) <= 3`) after certainty checks; choose the lowest-probability hidden cell adjacent to a revealed mine. Evaluate every board center over `dx,dy ∈ [-2,2]`, clip at edges, sum only hidden-cell probabilities, skip empty regions, and apply the approved last-bomb / expected-yield thresholds. Randomly break equal-value centers using the same injected random source.

- [x] **Step 5: Run policy RED-to-GREEN and verify no plugin-local solver remains**

Run: `node --test test/strong-plugin.test.js test/ai-edge-avoidance.test.js`; then search `plugin/` for `enumerateCluster`, `computeProbabilities`, `hiddenValue`, and plugin assignments to `MineCore.computeProbabilities`.
Expected: tests pass; no plugin still computes a probability table independently.

### Task 4: Replace unsafe AI decision fallback and coordinate-free bomb actions

**Files:**
- Modify: `js/ai-decision.js`
- Modify: `test/ai-decision.test.js`

**Interfaces:**

```js
MineAIDecision.resolve(game, player, decision, { fallbackDecision })
  -> { action: {type:'open'|'bomb', x:number, y:number} | null,
       invalid:boolean, noMoves:boolean }
```

The guard may inspect only the core fields needed to validate a proposed move (`w`, `h`, `revealed`, and `canBomb`); it never reads `mines` or chooses targets from hidden state. Plugins never receive the Game. Reject all `bomb-auto` requests. Invalid actions use the explicitly defined public-information Invincible fallback supplied by the UI; when its rule chooses exploration, random choice is restricted to `freeCells`.

- [x] **Step 1: Add failing tests for public fallback and bomb validation**

Replace the current test game object containing `revealed`/`canBomb` methods with a public-view fixture. Assert invalid actions choose the same result from identical visible analysis despite unrelated hidden layouts (do not expose either hidden layout to the fixture); `bomb-auto` is invalid; bomb requires integer in-bounds center and `canBomb`; fallback never selects outside the analysis-selected candidate set; no hidden cells returns `noMoves`.

- [x] **Step 2: Run decision tests and verify the expected RED**

Run: `node --test test/ai-decision.test.js`
Expected: old guard requires a Game-shaped object, accepts enhanced `bomb-auto`, and uniformly picks any hidden cell.

- [x] **Step 3: Implement the pure public-view guard**

Validate only `width`, `height`, `cellAt`, bomb permission and supplied `analysis`. Accept legal opens and coordinate bombs; reject `bomb-auto`, invalid coordinates, revealed targets, or bombs when permission/inventory disallows. On invalid actions call the shared Invincible-safe fallback selector, using `randomIndex` only within its chosen tie/exploration set. Return no move if there are no hidden cells.

- [x] **Step 4: Run RED-to-GREEN**

Run: `node --test test/ai-decision.test.js`.
Expected: all action validation, no-oracle fallback and free-only exploration tests pass.

### Task 5: Materialize public snapshots and share/cache analysis in UI

**Files:**
- Modify: `js/ui.js`
- Modify: `test/ui-settings-contract.test.js`
- Modify: `test/plugin-registry.test.js`

**Interfaces:**
- `getSharedAnalysis()` copies only public `cellAt(x,y)` values into a frozen ordinary array and creates a frozen snapshot whose reader closes only over copied values and local dimensions; `makeView(p, shared)` adds actor-specific public metadata and the shared immutable analysis. Plugins never receive Game or mutable core arrays.
- Cache analysis by public board dimensions, mine totals and visible cell values; a monotonic `boardRevision` is incremented/invalidation occurs after a successful move and on `newGame()`. Repeated hints/redraws/AI work on an unchanged public board reuse analysis.
- Materialize the actor view before awaiting plugin load; after every await and before applying an action, verify same `game` identity, board revision, turn, active game and current public state. Do not execute an old async decision.

- [x] **Step 1: Add failing UI contract tests**

`test/ui-settings-contract.test.js` asserts the shared public view, cache path, invalidation points and snapshot-before-await/revision freshness ordering. A live Playwright run is desirable for actual call-count and async interleaving behavior; the environment lacked Python `playwright` (`ModuleNotFoundError: No module named 'playwright'`), so those UI behaviors were checked with Node tests/static contracts instead.

- [x] **Step 2: Run UI contract tests and verify the expected RED**

Run: `node --test test/ui-settings-contract.test.js test/plugin-registry.test.js`.
Expected: existing UI passes Game-backed views directly and has no shared planner cache.

- [x] **Step 3: Implement copied snapshots, cache invalidation, and async freshness checks**

Implemented in `getSharedAnalysis()` and `makeView(p, shared)`: materialize visible cells synchronously before awaiting lazy plugin load, keep analysis keyed by public board values, increment `boardRevision` and invalidate after a successful move or `newGame()`, and provide fresh actor metadata with shared analysis. Recheck game identity/revision/turn/public state after plugin-load awaits and before applying. Right-click hints use the same cached analysis and `render()` never loads a plugin.

- [x] **Step 4: Run RED-to-GREEN**

Run: `node --test test/ui-settings-contract.test.js test/plugin-registry.test.js`.
Expected: snapshot isolation, one-solve reuse, invalidation and stale async action tests pass while lazy loading remains intact.

### Task 6: Remove hidden-state bomb oracle and obsolete enhanced-AI UI

**Files:**
- Modify: `js/ui.js`
- Modify: `js/core.js`
- Modify: `index.html`
- Modify: `plugin/ai-config.js`
- Modify: `test/bomb-area.test.js`
- Modify: `test/ai-decision.test.js`
- Modify: `test/ui-settings-contract.test.js`

**Interfaces:**
- Human bomb actions still call `game.bomb(x,y)`; AI bomb actions must include public-analysis-selected coordinates and call `game.bomb(x,y,{ai:true})`.
- `Game.bombBest()` and every UI call to it are removed; `bomb-auto`, `cfgEnhancedAI`, and the “增强 AI” control are removed.
- Keep `cfgDisableAiBombs` behavior and `Game.canBomb(...,{ai:true})` validation.

- [x] **Step 1: Add regression assertions that hidden oracle and legacy action do not exist**

Assert the AI UI path contains no `bombBest()` invocation; guard rejects `bomb-auto`; `Game.prototype.bombBest` is absent; AI bomb actions carry explicit coordinates and respect `disableAiBombs`; visible plugin help describes coordinate bombs and public `view.analysis` rather than auto-selection.

- [x] **Step 2: Run relevant tests and verify the expected RED**

Run: `node --test test/bomb-area.test.js test/ai-decision.test.js test/ui-settings-contract.test.js`.
Expected: legacy `bombBest`, enhanced setting and automatic dispatch violate the new assertions.

- [x] **Step 3: Delete hidden-state oracle and update contract/UI**

Remove `Game.bombBest()`, the enhanced-mode branch in the guard, `bomb-auto` from `applyDecision`, the `cfgEnhancedAI` control and its reads, and related help text. Preserve AI bomb legality in the core and keep the explicitly allowed human cheat display outside plugin snapshots. Update AI descriptions to state Invincible seeks public-information high-yield mines rather than “low risk”.

- [x] **Step 4: Run RED-to-GREEN**

Run: `node --test test/bomb-area.test.js test/ai-decision.test.js test/ui-settings-contract.test.js`.
Expected: no hidden oracle/action path remains; human bomb mode, fixed blast and AI permission tests pass.

### Task 7: Verify end-to-end public-state invariance and complete migration

**Files:**
- Modify: `test/ai-planner.test.js`
- Modify: `test/strong-plugin.test.js`
- Modify: `test/plugin-registry.test.js`
- Modify: `test/ui-settings-contract.test.js`
- Modify: `index.html`
- Modify: `plugin/ai-config.js`

**Interfaces:**
- The same exact public snapshot and identical injected random choices must yield equal planner output and decisions; differing hidden maps are never part of the test input.
- Plugin loading IDs and the `makeDecision(view)` interface remain unchanged; selected plugin scripts stay lazy-loaded.

- [x] **Step 1: Add cross-consumer and public-state invariance tests**

`test/ai-public-invariance.test.js` runs all three plugins against different hidden layouts with identical public views and compares shared analysis/bomb yields/actions. `test/ui-settings-contract.test.js` checks cache reuse wiring, revision invalidation points and freshness guards. A live browser call-count/async interleaving smoke test was not available because Python Playwright is not installed.

- [x] **Step 2: Run integration tests and verify the expected RED**

Run: `node --test test/ai-planner.test.js test/strong-plugin.test.js test/plugin-registry.test.js test/ui-settings-contract.test.js`.
Expected: any remaining separate analysis paths, cache mistakes or visibility leaks fail the targeted assertion.

- [x] **Step 3: Fix only integration defects exposed by the tests**

Keep one planner analysis per public board revision; keep plugin view and `analysis` immutable; ensure all probability-hint reads use the planner, and no plugin source includes a map/Game reference or local solver.

- [x] **Step 4: Run complete test suite and source audit**

Run: `node --test test/*.test.js`; then `git diff --check`; then search source for `bomb-auto`, `bombBest(`, `computeProbabilities`, and plugin references to `mines`.
Expected: all tests pass; no AI path uses the hidden-state bomb oracle; no plugin-local probability solver or `MineCore.computeProbabilities` side effect remains. The core may still access `this.mines` only to execute actual game rules and render the explicit player cheat display.

- [x] **Step 5: Review final diff against the approved spec**

Check each spec section 2–10 against the changed modules and tests. Confirm fixed `5×5` across dimensions, exact-vs-approximate semantics, Simple/Medium rule preservation, Invincible strategy order, stale async protection, and no unrelated map-generation or RNG changes.

---

## Approved policy-update execution tasks

Tasks 1–7 above describe the completed shared-planner baseline. The approved addendum supersedes their old removal of the enhanced option and `Game.bombBest()`; do not revert the shared planner, immutable public view, cache, or async safeguards while applying these tasks.

### Task 8: Implement the approved free-cell probability estimate

**Files:**
- Modify: `js/ai-planner.js`
- Modify: `test/ai-planner.test.js`

**Interfaces:** Keep `MineAIPlanner.analyze(publicView, options = {})` and `analysis.freeMineProbability: number | null`. For exact per-component enumeration, `minMines(component)` is the first nonzero total-mine stratum in that component’s histogram. Exact quality uses `clamp((remainMines - sum(minMines)) / freeCells.length, 0, 1)`; no free cells returns `null`. If a component cannot be enumerated exactly, preserve approximate quality/no-certainty behavior and the existing uniform fallback estimate.

- [x] **Step 1: Add a failing disconnected-component regression**

In the existing `separate frontier clusters combine with free-cell combinations before marginals are computed` test, keep the 15×1 fixture and exact marginal assertions. Change the expected `freeMineProbability` from `0.25` to `0.5`: the two disconnected frontier components each require at least one mine, leaving `(3 - 2) / 2 = 0.5` by the user’s formula.

- [x] **Step 2: Run the planner test and verify RED**

Run: `node --test test/ai-planner.test.js`
Expected: the component fixture fails only at `freeMineProbability` (`0.25 !== 0.5`); exact per-cell marginals remain unchanged.

- [x] **Step 3: Track each exact frontier component’s minimum mine count**

At component enumeration, find the least index `k` with a nonzero assignment histogram and add `k` to `minFrontierMines`. Pass that total into analysis construction. Set `freeMineProbability` to `null` for zero free cells; otherwise clamp `(state.remainMines - minFrontierMines) / free.length`. Add regressions where locally solvable components with an impossible global total clamp below zero to `0`, and where a valid exact global layout leaves more free mines than free cells to clamp above one to `1`. If all local components were enumerated but the global mine total is contradictory, retain this clamped user-defined scalar while keeping `quality:'approximate'` and certainty arrays empty. If component enumeration hit the cap or local constraints cannot be solved, keep the existing uniform approximate estimate. Do not change per-cell equal-weight marginals or certainty rules.

- [x] **Step 4: Verify planner RED-to-GREEN and edge cases**

Run: `node --test test/ai-planner.test.js`.
Expected: exact marginal oracle tests still pass; disconnected-component free estimate is `0.5`; no-free remains `null`; approximate/capped analysis exposes no certainties.

### Task 9: Apply the Simple and Medium bomb policies

**Files:**
- Modify: `plugin/ai-heuristic.js`
- Modify: `plugin/ai-global-probability.js`
- Modify: `test/ai-edge-avoidance.test.js`
- Modify: `test/strong-plugin.test.js`

**Interfaces:** Keep plugin IDs and `makeDecision(view)`. Both policies consume only `view.analysis.bombCenters`, whose entries already contain `{x,y,expectedMines,hiddenCount}`. Candidate centers must themselves be unrevealed (enforced in Task 10 and analysis output in Task 10). Simple bombs only while behind; Medium bombs only when `view.oppScore - view.score >= 5`.

- [x] **Step 1: Add behavior tests before changing either plugin**

Add tests asserting Simple returns a bomb when `view.canBomb` is true and it is trailing, chooses the candidate with greatest `hiddenCount` even when another center has a larger `expectedMines`, and does not bomb when tied/ahead. Add Medium tests asserting a 4-point deficit returns a normal open, a 5-point deficit permits bombing, and its chosen center has the greatest `expectedMines`. Keep tests for their existing ordinary move selection unchanged.

- [x] **Step 2: Run focused tests and verify RED**

Run: `node --test test/ai-edge-avoidance.test.js`.
Expected: old Simple max-expected-yield objective and old Medium threshold fail the new assertions.

- [x] **Step 3: Update only bomb timing and target scoring**

In Simple, replace `wantBomb(view)`’s score/win heuristics with `!!view.canBomb && view.bombs > 0 && view.score < view.oppScore`; choose max `hiddenCount`, preserving existing random tie selection. In Medium, request a bomb only when `view.canBomb && view.bombs > 0 && view.oppScore - view.score >= 5`; maximize `expectedMines`, preserving existing tie order. Leave all non-bomb open-move ordering untouched.

- [x] **Step 4: Verify policy tests GREEN**

Run: `node --test test/ai-edge-avoidance.test.js test/strong-plugin.test.js`.
Expected: new bomb policy tests pass and existing Simple/Medium ordinary move regressions remain green.

### Task 10: Enforce hidden bomb centers in analysis, core, and AI validation

**Files:**
- Modify: `js/ai-planner.js`
- Modify: `js/core.js`
- Modify: `js/ai-decision.js`
- Modify: `js/ui.js`
- Modify: `test/ai-planner.test.js`
- Modify: `test/bomb-area.test.js`
- Modify: `test/ai-decision.test.js`
- Modify: `test/ui-settings-contract.test.js`

**Interfaces:** `Game.bomb(x, y, {ai = false} = {})` is the final global rule boundary. `MineAIDecision.resolve(game, player, decision, {fallbackDecision})` accepts a bomb only when its integer in-range center satisfies `!game.revealed[y * game.w + x]`. An invalid AI action keeps the existing “AI 走昏招了！” warning and public fallback.

- [x] **Step 1: Add core and guard tests**

In `test/bomb-area.test.js`, make a bomb-eligible fixture with one revealed center and several hidden neighbors; assert `bomb(knownX,knownY)` returns `{ok:false,why:'center-not-hidden'}`, bomb inventory and `hiddenCount` are unchanged, and the bomb action reveals nothing. Repeat with `{ai:true}`. In `test/ai-decision.test.js`, assert a bomb on a revealed center resolves as `invalid:true` to the supplied legal fallback; keep the existing out-of-range `昏招` contract assertion.

- [x] **Step 2: Run focused tests and verify RED**

Run: `node --test test/bomb-area.test.js test/ai-decision.test.js`.
Expected: core currently accepts a revealed bomb center and the decision guard accepts an in-range revealed bomb center.

- [x] **Step 3: Reject non-hidden centers before bomb consumption**

In `Game.bomb`, after coordinate bounds validation and before permission, inventory, score, or reveal mutation, return `{ok:false,why:'center-not-hidden'}` if `this.revealed[y * this.w + x]` is true. In `MineAIDecision.resolve`, change the `bomb` branch to use the existing `isHidden(x,y)` predicate. In `createAnalysis`, add a `bombCenters` entry only when its center cell is `-2`, in addition to requiring a nonempty hidden blast area.

- [x] **Step 4: Reuse existing human and AI feedback paths**

In `onCellClick`, if `game.bomb(x,y)` returns `why === 'center-not-hidden'`, show `炸弹中心必须选择未翻开的格子` and leave the bomb/inventory/revealed state unchanged. Do not add an AI warning implementation: `scheduleAI()` already warns on `resolved.invalid`, and `applyDecision()` already warns if core rejects an action before recovering via the public fallback.

- [x] **Step 5: Verify all center-legality tests GREEN**

Run: `node --test test/ai-planner.test.js test/bomb-area.test.js test/ai-decision.test.js test/ui-settings-contract.test.js`.
Expected: human and AI core rejection, resolver rejection, legal-hidden center enumeration, and existing “昏招” warning/fallback tests pass.

### Task 11: Restore guarded Invincible BombBest and opponent-information policy

**Files:**
- Modify: `js/core.js`
- Modify: `test/bomb-area.test.js`

**Interfaces:** Restore `Game.bombBest()` as an engine-only automatic action. It checks `canBomb(this.turn,{ai:true})`, enumerates only centers satisfying `!this.revealed[center]`, counts actual mines in each clipped blast, and executes the highest-hit qualifying target through `Game.bomb()`. An immediate-win target bypasses only the known-component filter. Otherwise require `oppScore - score >= 3` and `knownComponentCountAfter <= knownComponentCountBefore`; no eligible target returns `{ok:false,why:'no-target'}` without consuming a bomb. `knownComponentCount` counts 8-neighbor connected components among revealed cells.

- [x] **Step 1: Add tests for gating, winning exception, and information filter**

Construct deterministic boards by setting their mine/revealed arrays in `test/bomb-area.test.js`. Assert: AI bomb disablement returns `why:'cannot'`; all-revealed centers are never selected; an immediate-winning highest-hit center is allowed even if it raises component count; non-winning auto bombs fail when the score deficit is under 3; candidates that increase known components are excluded; among remaining candidates, the highest actual hit count is chosen.

- [x] **Step 2: Run focused core tests and verify RED**

Run: `node --test test/bomb-area.test.js`.
Expected: `Game.bombBest` was undefined; new tests failed before implementation.

- [x] **Step 3: Implement the guarded engine-only target resolver**

Add a private `knownComponentCount(revealed,w,h)` traversal using 8-neighbor adjacency. Implement `Game.bombBest()` to enumerate unrevealed centers, calculate `mineHits` and post-blast component count, retain immediate-win candidates regardless of component increase, otherwise enforce deficit and information rules, select maximum mine hits with secure `MineCore.randInt` only among equal maxima, then call `this.bomb(x,y,{ai:true})`. Return failure without mutation when no candidate qualifies.

- [x] **Step 4: Verify core target tests GREEN**

Run: `node --test test/bomb-area.test.js`.
Expected: center legality, AI permission, immediate-win exception, late deficit, component filtering, and actual-hit maximum all pass.

### Task 12: Re-enable enhanced AI and route authorized automatic requests

**Files:**
- Modify: `index.html`
- Modify: `plugin/ai-constraint-probability.js`
- Modify: `js/ai-decision.js`
- Modify: `js/ui.js`
- Modify: `plugin/ai-config.js`
- Modify: `test/ai-decision.test.js`
- Modify: `test/strong-plugin.test.js`
- Modify: `test/ui-settings-contract.test.js`
- Modify: `test/plugin-registry.test.js`

**Interfaces:** Keep `makeDecision(view)`; add read-only `view.enhancedAI`. When it emits `{type:'bomb-auto',fallback:{type:'open'|'bomb',x,y}}`, the decision guard accepts it only if the caller authorizes the Invincible plugin, the enhanced checkbox is on, `canBomb(player,{ai:true})` is true, and the fallback is a legal coordinate action: open requires an unrevealed in-bounds cell; bomb also requires a hidden center and current AI bomb permission. If plugin fallback is invalid, use the scheduler’s public fallback. Return `{action:{type:'bomb-auto'},fallbackAction,invalid:false,noMoves:false}`. `applyDecision(p,action,fallbackAction)` rechecks plugin ID, current checkbox, turn and bomb permission, calls `game.bombBest()` only if still authorized, and executes the validated fallback if BombBest reports no target. A disabled/stale setting must never execute auto targeting.

- [x] **Step 1: Add failing contract and policy tests**

Test that `cfgEnhancedAI` is present and `checked` in `index.html`; Invincible emits `bomb-auto` only when `view.enhancedAI` is true and the automatic policy qualifies, with a legal coordinate fallback; disabled enhancement preserves coordinate-only bomb policy; other plugins and unauthorized guard calls cannot trigger auto; an auto target with no eligible center applies fallback; `cfgDisableAiBombs` blocks auto.

- [x] **Step 2: Run focused tests and verify RED**

`node --test test/strong-plugin.test.js test/ai-decision.test.js test/ui-settings-contract.test.js` initially confirmed absent `bomb-auto` handling, Invincible auto actions and default enhanced option; a test regex typo was fixed before implementation.

Run: `node --test test/ai-decision.test.js test/strong-plugin.test.js test/ui-settings-contract.test.js test/plugin-registry.test.js`.
Expected: UI has no enhanced option, guard rejects `bomb-auto`, and Invincible never requests the automatic action.

- [x] **Step 3: Implement default-on UI setting and actor-view flag**

Add `<input type="checkbox" id="cfgEnhancedAI" checked>` beside `cfgDisableAiBombs` in the new-game dialog. Set `view.enhancedAI` from its current checked state in `makeView`; keep it out of core hidden-state data and never pass `game` to plugins. Update visible copy and Invincible config description.

- [x] **Step 4: Add Invincible auto gate and validated fallback**

In `plugin/ai-constraint-probability.js`, keep the public coordinate policy as the fallback. When `view.enhancedAI && view.canBomb`, allow Invincible to request `{type:'bomb-auto',fallback:publicCoordinateAction}`; the engine-side `Game.bombBest()` decides whether an immediate-win or trailing-by-at-least-3 candidate actually qualifies. Otherwise return the normal coordinate/open action. Validate fallback coordinates in the guard; do not let the plugin inspect actual mine positions or known-component counts.

- [x] **Step 5: Resolve and revalidate auto actions in UI**

Authorize `bomb-auto` only when `kind[p] === 'constraint-probability'`, the live checkbox remains checked, and `game.canBomb(p,{ai:true})` is true. Pass the resolved fallback into `applyDecision`; after rechecking game identity/turn/status, call `game.bombBest()`. On `{ok:false}`, resolve and execute the supplied fallback using the existing core path. Keep `cfgDisableAiBombs` authoritative.

- [x] **Step 6: Verify UI/guard/plugin RED-to-GREEN**

Run: `node --test test/ai-decision.test.js test/strong-plugin.test.js test/ui-settings-contract.test.js test/plugin-registry.test.js`.
Expected: default-on setting, authorized-only auto, stale/disabled denial, coordinate fallback, and current lazy plugin loading all pass.

### Task 13: Add the human airplane bomb cursor

**Files:**
- Modify: `js/ui.js`
- Modify: `css/style.css`
- Modify: `test/ui-settings-contract.test.js`

**Interfaces:** During human `bombMode`, the currently hovered board cell remains `bombPreviewCenter`; its center cell renders one decorative inline-SVG airplane-bombing icon via a pseudo-element. The icon size is bounded by `var(--cs)`, uses `pointer-events:none`, and does not replace or obscure the existing 5×5 blast preview.

- [x] **Step 1: Add a static UI contract test**

Assert CSS has a bomb-mode center-icon rule scoped to `.cell.hidden.bomb-preview-center`, with bounded one-cell sizing and `pointer-events:none`; assert the board retains the existing `.bomb-preview` range class and that the text/help describes the airplane center icon and fixed `5×5` blast.

- [x] **Step 2: Run the contract test and verify RED**

`node --test test/ui-settings-contract.test.js` first failed because CSS still used `cursor: crosshair` and had no inline-SVG airplane rule. After implementation, the same contract passed 9/9.

- [x] **Step 3: Render the airplane icon without intercepting input**

Replace the bomb-mode crosshair with a hidden system cursor over `#board`; add a single-cell `::after` airplane/bomb SVG to the hidden hovered center cell. Preserve pointerenter-driven `bombPreviewCenter`, preview cell classes, normal cursor outside the board, and the existing center click handler.

- [x] **Step 4: Verify the real interaction in headed Edge**

Served `E:/tmp/mine_27b` on port `8765` with explicit working directory and opened `http://127.0.0.1:8765` via `playwright-cli open --browser=msedge --headed`. After 23 public UI clicks, the two-human fixture had Blue 2 : Red 3 and Blue to move. In bomb mode, hovering the hidden `(0,0)` center yielded a 44×44 inline SVG icon on a 44×44 cell, `cursor:none`, `pointer-events:none`, and 9 preview cells at the clipped corner. Clicking a revealed center displayed `炸弹中心必须选择未翻开的格子`, kept bomb mode active and left both bomb inventories at 1/1. Clicking hidden `(0,0)` then succeeded: Blue bombs 0/1, mode exited, and last move displayed `最后: 蓝方 炸弹扫区 · 炸中 2 雷 (0,0)`. Edge console showed only the existing missing `favicon.ico` 404. Closed the browser, stopped server PID 19500, and removed generated `.playwright-cli/` artifacts.

### Task 14: Final regression and source audit

**Files:**
- Verify all changed files; no additional implementation files expected.

- [x] **Step 1: Run all focused test groups**

`node --test test/ai-planner.test.js test/strong-plugin.test.js test/ai-edge-avoidance.test.js test/ai-decision.test.js test/bomb-area.test.js test/ui-settings-contract.test.js test/plugin-registry.test.js test/ai-public-invariance.test.js` passed 70/70.

- [x] **Step 2: Run the full suite and source audits**

`node --test test/*.test.js` passed 84/84; `git diff --check` passed (Git emitted only LF→CRLF working-copy warnings). `rg -n "Game\.bombBest|bomb-auto|cfgEnhancedAI|computeProbabilities" js plugin index.html` found the engine/UI guard and Invincible route; `computeProbabilities` had no matches. `rg -n "game\.mines|\.mines\[" plugin` had no matches. Diff review confirmed no `makeMap` or RNG changes.

- [x] **Step 3: Review the final diff against both specs**

Reviewed `docs/superpowers/specs/2026-10-06-minestorm-shared-ai-planner-design.md` and its approved override `docs/superpowers/specs/2026-10-06-minestorm-ai-bomb-policy-design-update.md` against implementation and tests. The component-minimum formula/null behavior, Simple/Medium ≥1/≥5 bomb rules, Invincible immediate-win and ≥3 deficit/component gate, enhanced default-on authorization/fallback, hidden-center rule, existing AI warning, SVG cursor/5×5 preview, plugin public-view boundary, fixed blast, stale-state guard and absence of map/RNG edits all match.
