# MineStorm Shared AI Planner Implementation Plan

> **For agentic workers:** This plan is being executed inline in the current session. Follow each task in order, write tests first, prove each test fails for the intended reason, implement the smallest change, then prove it passes. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicated AI probability logic with one public-information planner, give Invincible the approved frontier/free and late-game strategy, make bomb blasts fixed `5×5`, and remove AI access to hidden-mine bomb targeting.

**Architecture:** Add `js/ai-planner.js` to build an immutable analysis snapshot solely from a materialized public view; all three existing lazy-loaded plugins consume that snapshot. Keep Simple and Medium's current difficulty decision rules while changing only their probability source; implement the new candidate, endgame and expected-bomb-yield rules for Invincible. The UI caches one analysis per public-board revision and uses it for AI and hints; the core applies fixed `5×5` blast geometry to both human and AI bombs.

**Tech Stack:** Static HTML/CSS/vanilla JavaScript; Node.js built-in `node:test`; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-06-minestorm-shared-ai-planner-design.md`

## Global Constraints

- “exact” means exact marginal probabilities under equally weighted mine configurations satisfying public clues and remaining-mine count; it is not calibrated to `makeMap`'s farthest-distance generation.
- AI, hints, bomb selection, and invalid-action fallback use public information only; no AI path reads `Game.mines` or calls `Game.bombBest()`.
- The blast is a centered `5×5` square (horizontal and vertical radius 2), clipped at board edges; board dimensions remain configurable and do not change the blast size.
- Keep the plugin contract `makeDecision(view)` and lazy-load only the selected AI; add `view.analysis` without giving plugins a `Game` reference or mutable hidden-state closure.
- Preserve Simple and Medium decision rules; only their probability source changes to the shared analysis. Invincible follows spec sections 5–6.
- Preserve the mine-map generator and secure RNG; add no dependency or persisted AI state.
- At an approximate analysis quality, expose no certain mines/safes even when an estimate is 0 or 1.
- Run focused `node --test` files after each task and `node --test test/*.test.js` at the end.

## File Map

- `js/ai-planner.js` (new): public-view materialization helpers, exact constraint enumeration/global conditioning, explicit approximate fallback, immutable analysis API.
- `js/core.js`: fixed bomb radii, public view fields, `bombAreaCells`; retain the legacy `bombBest()` only until the AI/UI cutover task removes it.
- `js/ai-decision.js`: public action validation and policy-based open fallback; reject coordinate-free `bomb-auto`.
- `plugin/ai-heuristic.js`: preserve Simple's selection rules while consuming `view.analysis`; remove its local probability propagation.
- `plugin/ai-global-probability.js`: preserve Medium's selection rules while consuming `view.analysis`; remove the duplicate solver and `MineCore.computeProbabilities` side effect.
- `plugin/ai-constraint-probability.js`: implement Invincible's exact-certain, frontier/free, endgame and public expected-yield bomb policy using shared analysis.
- `plugin/ai-config.js`: correct descriptions to match behavior and remove “low-risk” mischaracterization for Invincible.
- `js/ui.js`: materialize immutable public views, maintain board-revision analysis cache, share analysis with AI/hints, validate async decisions against current state, remove `bomb-auto` dispatch.
- `index.html`: load the planner before UI/plugins, remove enhanced-AI control and obsolete contract text, describe fixed 5×5 blasts.
- `test/ai-planner.test.js` (new): planner exactness, classification, fallback, immutability and input-validation tests.
- `test/bomb-area.test.js`: fixed blast geometry across board sizes and edge clipping; remove tests that endorse the hidden-state AI oracle.
- `test/strong-plugin.test.js` and `test/ai-edge-avoidance.test.js`: policy behavior tests against explicit shared analysis fixtures.
- `test/ai-decision.test.js`: coordinate bomb validation, no-hidden fallback and recovery policy.
- `test/ui-settings-contract.test.js`, `test/plugin-registry.test.js`: script order, removed enhanced-AI setting, lazy plugin contract, and updated descriptions.

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
