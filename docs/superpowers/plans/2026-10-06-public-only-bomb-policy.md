# Public-Information-Only Bomb Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hidden-map automatic bomb selection with a public-information-only Invincible policy that spends bombs when their expected yield cannot tie and uses a last single-region opportunity to maximize estimated one-move win probability.

**Architecture:** The planner will publish an independent-marginal hit-count estimate per legal blast center and a conservative exact-analysis predicate for a single remaining mine region. Invincible will return a concrete `{ type: 'bomb', x, y }` selected from those public fields. The decision guard, UI, core integration, and tournament runtime will no longer expose or invoke hidden-map bomb selection; `Game.bomb(x, y)` remains responsible for actual move resolution after selection.

**Tech Stack:** Browser JavaScript; Node.js `node:test` and `vm` tests; no package manifest or third-party dependencies.

**Spec:** `docs/superpowers/specs/2026-10-06-public-only-bomb-policy-design.md`

## Global Constraints

- AI decisions may use only public cells, public scores/inventory, `canBomb`, and public posterior analysis; never use actual mine locations to select, validate, or veto a bomb before action resolution.
- `Game.bomb()` may read actual mines only to apply the chosen coordinate and resolve its real consequences.
- Preserve official bomb legality, including being behind, bomb inventory, game-over state, and `disableAiBombs`.
- Assert the single-region endgame only for exact public analysis with a nonempty frontier constraint, one 8-neighbor component of possible mine cells, and zero posterior mine probability outside it.
- Treat the hit-count distribution as an independent-marginal estimate, not an exact joint posterior or guarantee.
- Preserve human bomb behavior, 5×5 blast geometry, score rules, and the no-new-dependencies constraint.
- Verify with `node --test test/*.test.js`; the repository uses Node built-ins and has no package scripts.

---

### Task 1: Publish public bomb-hit estimates and decisive-region analysis

**Files:**
- Modify: `js/ai-planner.js`
- Test: `test/ai-planner.test.js`

**Interfaces:**
- Add `estimatedHitCountProbabilities: number[]` to each `analysis.bombCenters` candidate. Index `k` is the independent-marginal estimate that the blast contains exactly `k` hidden mines; freeze the array with the candidate.
- Add `analysis.singlePossibleMineRegion: boolean`. It is true only for exact analysis with at least one frontier constraint, exactly one 8-neighbor connected component among hidden cells whose posterior mine probability is greater than zero, and zero posterior mine probability for every hidden cell outside that component.
- Keep `expectedMines` as the sum of the same public marginals and preserve existing candidate ordering/immutability guarantees.

- [ ] **Step 1: Write failing distribution and region tests**

Add to `test/ai-planner.test.js`:

```js
test('bomb centers publish independent-marginal hit-count estimates', () => {
  const board = view(3, 2, [0, -2, -2, -2, -2, -2], 1);
  const analysis = planner.analyze(board);
  const center = analysis.bombCenters.find(candidate => candidate.x === 2 && candidate.y === 0);

  assert.equal(analysis.quality, 'exact');
  assert.ok(center);
  assert.equal(center.expectedMines, 1);
  assert.deepEqual(Array.from(center.estimatedHitCountProbabilities), [0.25, 0.5, 0.25]);
  assert.equal(Object.isFrozen(center.estimatedHitCountProbabilities), true);
});

test('single possible mine region requires an exact constrained frontier and excludes opening/free regions', () => {
  const decisive = planner.analyze(view(3, 3, [1, 1, 1, 1, -2, 1, 1, 1, 1], 1));
  assert.equal(decisive.quality, 'exact');
  assert.equal(decisive.singlePossibleMineRegion, true);

  const untouched = planner.analyze(view(3, 3, Array(9).fill(-2), 1));
  assert.equal(untouched.quality, 'exact');
  assert.equal(untouched.singlePossibleMineRegion, false);

  const separated = planner.analyze(view(5, 1, [-2, 1, -2, 1, -2], 2, 2));
  assert.equal(separated.quality, 'exact');
  assert.equal(separated.singlePossibleMineRegion, false);

  const approximate = planner.analyze(view(3, 2, [-1, 0, -2, -2, -2, -2], 0, 1));
  assert.equal(approximate.quality, 'approximate');
  assert.equal(approximate.singlePossibleMineRegion, false);
});
```

Update the two existing bomb-center shape assertions in `test/ai-planner.test.js` to compare the old `{x, y, expectedMines, hiddenCount}` projection separately from the new distribution field.

- [ ] **Step 2: Run planner tests and verify the new contract fails**

Run: `node --test test/ai-planner.test.js`
Expected: the new assertions fail because `estimatedHitCountProbabilities` and `singlePossibleMineRegion` are not yet returned.

- [ ] **Step 3: Implement public estimates in `js/ai-planner.js`**

For each legal center, start the Poisson-binomial convolution at `[1]`, visit only hidden cells in its blast, and update the count distribution from `analysis.mineProbabilityAt(x, y)`:

```js
const next = new Array(distribution.length + 1).fill(0);
for (let hits = 0; hits < distribution.length; hits++) {
  next[hits] += distribution[hits] * (1 - probability);
  next[hits + 1] += distribution[hits] * probability;
}
distribution = next;
```

Freeze the result. Compute `singlePossibleMineRegion` only when `quality === 'exact'` and `frontierCells.length > 0`: collect hidden cells with `p > 0`, traverse 8-neighbor adjacency, require exactly one component, and verify every other hidden cell has `p === 0`. Return `false` for approximate analyses and for an empty possible-mine set.

- [ ] **Step 4: Run planner tests and verify they pass**

Run: `node --test test/ai-planner.test.js`
Expected: all planner tests pass, including existing expected-yield, coverage, and immutability checks.

- [ ] **Step 5: Commit the planner contract**

```bash
git add js/ai-planner.js test/ai-planner.test.js
git commit -m "feat: expose public bomb hit estimates"
```

---

### Task 2: Apply the unified public use/save policy in Invincible

**Files:**
- Modify: `plugin/ai-constraint-probability.js`
- Test: `test/strong-plugin.test.js`

**Interfaces:**
- `chooseBomb(view)` returns either `null` or a coordinate action `{ type: 'bomb', x, y }`; remove its fallback/auto-bomb return shape.
- Consume `analysis.singlePossibleMineRegion` and each center's `estimatedHitCountProbabilities` from Task 1.

- [ ] **Step 1: Replace fixed-gate tests with use/save and endgame tests**

In `test/strong-plugin.test.js`, replace the tests that require a four-point deficit, two-thirds coverage, enhanced-mode auto-bomb, or `immediateWinOnly` with:

```js
test('Invincible spends when maximum expected blast yield cannot tie, otherwise conserves', () => {
  const desperateCells = Array(225).fill(-2);
  for (let cell = 0; cell < 25; cell++) desperateCells[cell] = -1;
  const desperate = view(15, 15, desperateCells, {
    mineCount: 53, remainMines: 28, bombs: 1, canBomb: true, score: 0, oppScore: 25,
  });
  randomIndex(0);
  const maximum = Math.max(...desperate.analysis.bombCenters.map(candidate => candidate.expectedMines));
  assert.equal(desperate.analysis.singlePossibleMineRegion, false);
  assert.ok(maximum < desperate.oppScore - desperate.score);
  const action = decide(desperate);
  const best = desperate.analysis.bombCenters.find(candidate => candidate.expectedMines === maximum);
  assert.deepEqual(action, { type: 'bomb', x: best.x, y: best.y });

  const recoverableCells = Array(225).fill(-2);
  for (let cell = 0; cell < 5; cell++) recoverableCells[cell] = -1;
  const recoverable = view(15, 15, recoverableCells, {
    mineCount: 53, remainMines: 48, bombs: 1, canBomb: true, score: 0, oppScore: 5,
  });
  assert.ok(Math.max(...recoverable.analysis.bombCenters.map(candidate => candidate.expectedMines)) >= 5);
  assert.equal(decide(recoverable).type, 'open');

  const boundary = view(3, 2, Array(6).fill(-2), {
    mineCount: 1, remainMines: 1, bombs: 1, canBomb: true, score: 0, oppScore: 1,
  });
  boundary.analysis = {
    ...boundary.analysis,
    singlePossibleMineRegion: false,
    bombCenters: [{ x: 1, y: 0, hiddenCount: 1, expectedMines: 1, estimatedHitCountProbabilities: [0, 1] }],
  };
  assert.equal(decide(boundary).type, 'open');

  const noCenters = view(3, 2, Array(6).fill(-2), {
    mineCount: 1, remainMines: 1, bombs: 1, canBomb: true, score: 0, oppScore: 2,
  });
  noCenters.analysis = { ...noCenters.analysis, singlePossibleMineRegion: false, bombCenters: [] };
  assert.equal(decide(noCenters).type, 'open');
});

test('Invincible uses a legal last-region bomb and selects the best public win estimate', () => {
  const width = 7, height = 7;
  const hidden = [23, 24, 25];
  const captured = [0, 48];
  const mines = [...hidden, ...captured];
  const cells = Array(width * height).fill(-2);
  for (let index = 0; index < cells.length; index++) {
    if (hidden.includes(index)) continue;
    if (captured.includes(index)) { cells[index] = -1; continue; }
    const x = index % width, y = Math.floor(index / width);
    let adjacent = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < width && ny < height && mines.includes(ny * width + nx)) adjacent++;
    }
    cells[index] = adjacent;
  }
  const certainRegion = view(width, height, cells, {
    mineCount: 5, remainMines: 3, bombs: 1, canBomb: true, score: 0, oppScore: 2,
  });
  assert.equal(certainRegion.analysis.quality, 'exact');
  assert.equal(certainRegion.analysis.singlePossibleMineRegion, true);
  assert.deepEqual(Array.from(certainRegion.analysis.hiddenCells), hidden);
  const action = decide(certainRegion);
  const selected = certainRegion.analysis.bombCenters.find(candidate => candidate.x === action.x && candidate.y === action.y);
  assert.equal(action.type, 'bomb');
  assert.equal(selected.estimatedHitCountProbabilities[3], 1);

  const estimated = view(3, 2, Array(6).fill(-2), {
    mineCount: 5, remainMines: 5, bombs: 1, canBomb: true, score: 1, oppScore: 2,
  });
  estimated.analysis = {
    ...estimated.analysis,
    singlePossibleMineRegion: true,
    bombCenters: [
      { x: 0, y: 0, hiddenCount: 2, expectedMines: 1, estimatedHitCountProbabilities: [0.5, 0, 0.5] },
      { x: 1, y: 0, hiddenCount: 2, expectedMines: 1.25, estimatedHitCountProbabilities: [0, 0.75, 0.25] },
    ],
  };
  assert.deepEqual(decide(estimated), { type: 'bomb', x: 0, y: 0 });

  estimated.analysis = {
    ...estimated.analysis,
    bombCenters: [
      { x: 0, y: 0, hiddenCount: 2, expectedMines: 1, estimatedHitCountProbabilities: [0.5, 0, 0.5] },
      { x: 1, y: 0, hiddenCount: 2, expectedMines: 1.5, estimatedHitCountProbabilities: [0.5, 0, 0.5] },
    ],
  };
  assert.deepEqual(decide(estimated), { type: 'bomb', x: 1, y: 0 });
});
```

Add a real exact-analysis regression with this 7×7 public fixture so an early return for certain mines cannot bypass the desperate-use rule:

```js
const cells = [
  -1, 1, 0, 0, -2, -2, -2,
  -2, -2, 1, -2, -2, 4, -1,
  -2, -2, -1, -2, -2, -2, -1,
  0, -2, 1, 2, 3, -1, 3,
  1, 2, 2, 2, 2, 1, 1,
  -1, -2, -1, -2, -2, -2, 0,
  1, 2, -2, 2, 1, 0, 0,
];
const board = view(7, 7, cells, {
  mineCount: 10, remainMines: 3, bombs: 1, canBomb: true, score: 2, oppScore: 5,
});
assert.equal(board.analysis.quality, 'exact');
assert.ok(board.analysis.certainMines.length > 0);
assert.equal(board.analysis.singlePossibleMineRegion, false);
assert.ok(Math.max(...board.analysis.bombCenters.map(candidate => candidate.expectedMines)) < 3);
assert.equal(decide(board).type, 'bomb');
```

Keep or add tests that leading, `canBomb === false`, and zero inventory never return bombs. No test may expect `bomb-auto` or `immediateWinOnly`.

- [ ] **Step 2: Run plugin tests and verify they fail for old policy**

Run: `node --test test/strong-plugin.test.js`
Expected: the new use/save and coordinate assertions fail against fixed score/coverage gates and the current auto-bomb behavior.

- [ ] **Step 3: Implement the single policy before any certain-mine early return**

Replace `chooseImmediateWinBomb` and the legacy gates with public selection:

```js
function chooseBomb(view) {
  if (!view.canBomb || view.bombs <= 0) return null;
  const candidates = (view.analysis.bombCenters || []).filter(candidate => candidate.hiddenCount > 0);
  if (!candidates.length) return null;

  if (view.analysis.singlePossibleMineRegion) {
    const needed = Math.floor(view.mineCount / 2) + 1 - view.score;
    const best = selectByEstimatedWinProbability(candidates, needed);
    return { type: 'bomb', x: best.x, y: best.y };
  }

  const best = selectByExpectedMines(candidates);
  if (best.expectedMines < view.oppScore - view.score) {
    return { type: 'bomb', x: best.x, y: best.y };
  }
  return null;
}
```

Implement `selectByExpectedMines(candidates)` by finding the maximum `expectedMines`, collecting equal-yield candidates, and selecting the seeded-random tie. Implement `selectByEstimatedWinProbability(candidates, needed)` by summing `estimatedHitCountProbabilities[hits]` for `hits >= needed`, collecting maximum-probability candidates, then delegating to `selectByExpectedMines` for ties. Call `chooseBomb(view)` before the exact `certainMines` return so neither decision branch bypasses bomb policy. If it returns null, keep the existing public open selection and legal fallback.

- [ ] **Step 4: Run plugin tests and verify they pass**

Run: `node --test test/strong-plugin.test.js`
Expected: desperate-use, expected-yield conservation, single-region use, certain-mine ordering, and legality tests pass.

- [ ] **Step 5: Commit the policy**

```bash
git add plugin/ai-constraint-probability.js test/strong-plugin.test.js
git commit -m "feat: apply public bomb use policy"
```

---

### Task 3: Remove hidden-map bomb selection from core and all action routers

**Files:**
- Modify: `js/core.js`, `js/ai-decision.js`, `js/ui.js`, `scripts/ai-tournament-runtime.js`
- Modify tests: `test/bomb-area.test.js`, `test/ai-decision.test.js`, `test/ai-tournament.test.js`, `test/ui-settings-contract.test.js`

**Interfaces:**
- The sole AI bomb action is `{ type: 'bomb', x, y }`.
- UI and tournament runtime execute it as `game.bomb(x, y, { ai: true })`.
- `Game.bombBest` is absent; no runtime/test plumbing accepts `bomb-auto` or `immediateWinOnly`.

- [ ] **Step 1: Write failing API and routing tests**

Replace the core test `core exposes an engine-only automatic bomb action` with:

```js
test('core does not expose hidden-map automatic bomb selection', () => {
  assert.equal(typeof game().bombBest, 'undefined');
});
```

In `test/ai-decision.test.js`, replace the existing `coordinate-free bomb-auto requests are rejected` test with this stronger authorized-case regression; it fails against the currently authorized auto-bomb route and passes once only coordinate actions are supported:

```js
test('coordinate-free bomb-auto is invalid after removal of the hidden selector', () => {
  const result = resolve(game([0, 0, 0, 0]), 'red', {
    type: 'bomb-auto', fallback: { type: 'open', x: 1, y: 1 },
  }, {
    pluginId: 'constraint-probability', enhancedAI: true, fallbackDecision: fallback,
  });
  assert.deepEqual(plain(result), { action: fallback, invalid: true, noMoves: false });
});
```

Replace the auto-bomb tournament test with this coordinate-routing integration:

```js
test('runMatch executes and traces the exact coordinate requested by Invincible', () => {
  const runtime = createRuntime(6);
  const NativeGame = runtime.core.MineCore.Game;
  const calls = [];
  runtime.core.MineCore.Game = class extends NativeGame {
    constructor(config) {
      super(config);
      const firstMine = this.mines.findIndex(Boolean);
      this.revealed[firstMine] = 1;
      this.owner[firstMine] = 2;
      this.scores.red = 1;
      this.hiddenCount--;
    }
    bomb(x, y, options) {
      calls.push({ x, y, ai: options?.ai });
      return super.bomb(x, y, options);
    }
  };
  runtime.decisions['constraint-probability'] = view => {
    const cell = view.analysis.hiddenCells[0];
    if (view.canBomb && view.bombs > 0) {
      const center = view.analysis.bombCenters[0];
      return { type: 'bomb', x: center.x, y: center.y };
    }
    return { type: 'open', x: cell % view.width, y: Math.floor(cell / view.width) };
  };
  const result = runMatch({
    seed: 6, invincibleSide: 'blue', opponentId: 'heuristic',
    width: 7, height: 7, mineCount: 9, bombCount: 1, includeTrace: true,
  }, runtime);
  const traced = result.trace.find(step => step.resolvedAction.type === 'bomb').resolvedAction;
  assert.deepEqual(calls[0], { x: traced.x, y: traced.y, ai: true });
  assert.equal(Object.hasOwn(traced, 'immediateWinOnly'), false);
});
```

Update `test/ui-settings-contract.test.js` to assert the coordinate route and absence of hidden-auto plumbing:

```js
assert.match(uiSource, /game\.bomb\([^,]+\.x,\s*[^,]+\.y,\s*\{\s*ai:\s*true\s*\}\)/);
assert.doesNotMatch(uiSource, /bombBest|bomb-auto|immediateWinOnly/);
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `node --test test/bomb-area.test.js test/ai-decision.test.js test/ai-tournament.test.js test/ui-settings-contract.test.js`
Expected: core still exposes `bombBest`, and the runtime still accepts/routes `bomb-auto`.

- [ ] **Step 3: Delete hidden selector and simplify action routing**

Remove `Game.bombBest()` and any helper used only by it (including core-side component counting). Keep `Game.bombAreaCells()` and `Game.bomb()` unchanged for physical resolution. In `js/ai-decision.js`, accept only legal open or coordinate bomb actions. In `js/ui.js`, remove the `bomb-auto` branch and call the existing coordinate `game.bomb(action.x, action.y, { ai: true })` route. In `scripts/ai-tournament-runtime.js`, make the same direct coordinate call; remove `immediateWinOnly` from decision copying and trace fields.

Remove the `bombBest()`-specific tests and fixtures from `test/bomb-area.test.js`; retain geometry, legality, no-spend-on-illegal-center, and coordinate-resolution tests. Remove all obsolete `bomb-auto` expectations and replace them with the coordinate action contract.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `node --test test/bomb-area.test.js test/ai-decision.test.js test/ai-tournament.test.js test/ui-settings-contract.test.js`
Expected: all tests pass, including the original seeded invalid-decision rejection.

- [ ] **Step 5: Search production code for the removed API and commit**

Run: `rg -n 'bombBest|immediateWinOnly|bomb-auto' js plugin scripts --glob '*.js'`
Expected: no matches.

```bash
git add js/core.js js/ai-decision.js js/ui.js scripts/ai-tournament-runtime.js test/bomb-area.test.js test/ai-decision.test.js test/ai-tournament.test.js test/ui-settings-contract.test.js
git commit -m "refactor: remove hidden bomb auto selection"
```

---

### Task 4: Prove hidden-map invariance and validate tournament behavior

**Files:**
- Modify: `test/ai-public-invariance.test.js`
- Modify: `docs/superpowers/reports/2026-10-06-minestorm-ai-baseline.md`

- [ ] **Step 1: Add a hidden-map invariance assertion for bomb decisions**

Extend `test/ai-public-invariance.test.js`. Generalize `boardWithMines` so optional `{ width = 7, height = 7, mineCount = indices.length, captured = [] }` configures `Game`; after setting `board.mines`, set each captured index's `revealed[index] = 1` and `owner[index] = 2`, then set `board.scores.red = captured.length` and decrement `board.hiddenCount` by that length. Existing 7×7 callers retain their defaults. Add this test:

```js
test('Invincible bomb decisions ignore the hidden mine layout', () => {
  const captured = Array.from({ length: 25 }, (_, index) => index);
  const left = boardWithMines([...captured, ...Array.from({ length: 28 }, (_, i) => 25 + i)], {
    width: 15, height: 15, mineCount: 53, captured,
  });
  const right = boardWithMines([...captured, ...Array.from({ length: 28 }, (_, i) => 197 + i)], {
    width: 15, height: 15, mineCount: 53, captured,
  });
  const leftView = publicDecisionView(left), rightView = publicDecisionView(right);
  const project = analysis => ({
    quality: analysis.quality,
    singlePossibleMineRegion: analysis.singlePossibleMineRegion,
    hiddenCells: Array.from(analysis.hiddenCells),
    bombCenters: Array.from(analysis.bombCenters, candidate => [
      candidate.x, candidate.y, candidate.expectedMines,
      Array.from(candidate.estimatedHitCountProbabilities),
    ]),
  });

  assert.notDeepEqual(Array.from(left.mines), Array.from(right.mines));
  assert.equal(leftView.canBomb, true);
  assert.equal(leftView.oppScore, 25);
  assert.equal(leftView.remainMines, 28);
  assert.deepEqual(
    Array.from({ length: 225 }, (_, i) => leftView.cellAt(i % 15, Math.floor(i / 15))),
    Array.from({ length: 225 }, (_, i) => rightView.cellAt(i % 15, Math.floor(i / 15))),
  );
  assert.deepEqual(project(leftView.analysis), project(rightView.analysis));
  assert.ok(Math.abs(Math.max(...leftView.analysis.bombCenters.map(candidate => candidate.expectedMines)) - 3.5) < 1e-12);

  const leftAction = plugins['constraint-probability'](leftView);
  const rightAction = plugins['constraint-probability'](rightView);
  assert.equal(leftAction.type, 'bomb');
  assert.deepEqual(leftAction, rightAction);
});
```

The 25 known captured mines and all 200 other cells produce the same public view; the two boards differ only in the remaining hidden mine positions. With public expected yield approximately 3.5 (allowing floating-point tolerance) below score gap 25, both decisions must be coordinate bombs. Never pass hidden arrays into the plugin or planner.

- [ ] **Step 2: Run the focused invariance test**

Run: `node --test test/ai-public-invariance.test.js`
Expected: both different hidden layouts produce identical analyses and the same concrete coordinate bomb; the test passes after Tasks 1–3.

- [ ] **Step 3: Run the full test suite**

Run: `node --test test/*.test.js`
Expected: all tests pass, including planner distribution/region cases, every policy branch, coordinate routing, and hidden-map invariance.

- [ ] **Step 4: Run a tournament smoke and a paired standard evaluation**

Smoke command:

```sh
time node scripts/ai-tournament.js --opponent both --seed-start 100000 --seed-count 10 --output 'C:/Users/keyn1/AppData/Local/Temp/minestorm-ai-baseline-Kk2vfn/public-only-smoke-10.json' > 'C:/Users/keyn1/AppData/Local/Temp/minestorm-ai-baseline-Kk2vfn/public-only-smoke-10.stdout.json'
```

Formal paired command (standard 15×15, 53 mines, one bomb; 1,000 seeds/opponent and both seats):

```sh
time node scripts/ai-tournament.js --opponent both --seed-start 100000 --seed-count 1000 --output 'C:/Users/keyn1/AppData/Local/Temp/minestorm-ai-baseline-Kk2vfn/public-only-1000.json' > 'C:/Users/keyn1/AppData/Local/Temp/minestorm-ai-baseline-Kk2vfn/public-only-1000.stdout.json'
```

Expected: no invalid decisions or incomplete matches; each opponent has 2,000 games and 1,000 paired map hashes matching the strict baseline file `C:/Users/keyn1/AppData/Local/Temp/mine27b-baseline-1000.json`. Verify pairing with this command:

```sh
node - <<'NODE'
const assert = require('node:assert/strict');
const baseline = require('C:/Users/keyn1/AppData/Local/Temp/mine27b-baseline-1000.json');
const treatment = require('C:/Users/keyn1/AppData/Local/Temp/minestorm-ai-baseline-Kk2vfn/public-only-1000.json');
for (const id of ['heuristic', 'global-probability']) {
  const before = baseline.opponents[id].seedClusters;
  const after = treatment.opponents[id].seedClusters;
  assert.equal(before.length, 1000);
  assert.equal(after.length, 1000);
  for (let index = 0; index < 1000; index++) {
    assert.equal(after[index].seed, before[index].seed);
    assert.equal(after[index].mapHash, before[index].mapHash);
    assert.deepEqual(after[index].games.map(game => game.invincibleSide), before[index].games.map(game => game.invincibleSide));
    assert.deepEqual(after[index].games.map(game => game.invincibleSide).sort(), ['blue', 'red']);
    assert.deepEqual(after[index].games.map(game => game.mapHash), [before[index].mapHash, before[index].mapHash]);
  }
  assert.equal(treatment.opponents[id].summary.games, 2000);
  assert.equal(treatment.opponents[id].summary.errors, 0);
}
NODE
```

Record win/draw/loss, confidence interval, average margin, bomb-use rate, and errors from the treatment JSON. Do not infer exact blast success from marginal estimates.

- [ ] **Step 5: Update the report with the public-only treatment and limitations**

In `docs/superpowers/reports/2026-10-06-minestorm-ai-baseline.md`, preserve prior results as historical comparisons, mark the engine-oracle direct-win policy superseded by the public-only strategy, and add the new paired run command, summaries, validation, and artifact path. State that endgame win selection uses an independent-marginal estimate and that results apply only to the evaluated seeds.

- [ ] **Step 6: Validate documentation and commit the final evidence**

```bash
git diff --check
git add test/ai-public-invariance.test.js docs/superpowers/reports/2026-10-06-minestorm-ai-baseline.md
git commit -m "test: validate public-only bomb strategy"
```
