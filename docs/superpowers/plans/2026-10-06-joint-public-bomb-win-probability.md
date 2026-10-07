# Joint Public Bomb Win Probability Implementation Plan

> **For agentic workers:** Use this plan task-by-task. Check off steps only after their stated test passes. Keep one writer in this working tree.

**Goal:** Replace the faulty connected-region bomb branch with a public joint hit-count probability and a tournament-calibrated direct-win override.

**Architecture:** Extend `js/ai-planner.js` to count per-blast mine-hit distributions under a clearly named uniform-valid-layout model; never expose a region-connectivity flag or call independent marginals an exact joint posterior. `plugin/ai-constraint-probability.js` will apply a configurable direct-win cutoff and retain the expected-yield/comeback fallback. The paired tournament runtime will inject cutoffs, record forecasts and realized direct wins, and compare treatment/control results by seed cluster.

**Tech Stack:** Browser JavaScript; Node.js `node:test`, `vm`, and built-in modules; no new dependencies. Standard board: 15×15, 53 mines, one bomb.

**Spec:** `docs/superpowers/specs/2026-10-06-joint-public-bomb-win-probability.md`; mathematical details: `alg.md`.

## Global Constraints

- Decision code sees only the public AI view and planner result; never inspect `Game.mines`, seeds, hidden-map artifacts, or post-action results before choosing a coordinate.
- Keep `Game.canBomb` and `Game.bomb(x, y, { ai: true })` as the official legality and resolution paths; do not change board rules or the 5×5 footprint.
- `uniformHitCountProbabilities` is exact only under uniformly weighted public-consistent layouts, not under the iterative farthest-placement generator.
- Joint hit counts are opt-in: `analyze(view, { includeJointHitDistributions: true })`. The UI/tournament runtime request them only when Invincible is the actor, `canBomb` is true, inventory remains, and a numeric cutoff is configured. This avoids the measured cost of evaluating every center on every player's turn.
- Approximate planner output never triggers the direct-win override.
- Remove `singlePossibleMineRegion` and `estimatedHitCountProbabilities`; do not keep compatibility aliases.
- A numeric cutoff must be finite and in `(0, 1]`; `null`/`off` disables the override so `Pwin = 0` cannot qualify.
- Select the product cutoff from development data, then verify it on disjoint validation seeds. The completed screen selected `0.5`; see Task 4 and the paired-results report.
- Preserve the no-dependency constraint and run `node --test test/*.test.js` before completion.

---

### Task 1: Compute exact public joint bomb-hit distributions

**Files:**
- Modify: `js/ai-planner.js`
- Test: `test/ai-planner.test.js`

**Interfaces:**
- Each `analysis.bombCenters` candidate keeps `{ x, y, hiddenCount, expectedMines }` and adds `uniformHitCountProbabilities: number[] | null`.
- At exact quality with `includeJointHitDistributions: true`, index `k` is the chance of exactly `k` hidden mines in that clipped 5×5 blast under the uniform-valid-layout model. Otherwise (unrequested or approximate), it is `null`.
- `expectedMines` equals the distribution first moment when the exact distribution is available.
- Remove `analysis.singlePossibleMineRegion` and candidate `estimatedHitCountProbabilities`.
- Private `computeBombHitDistributions(state, clusters, free, remainMines, denominator)` returns requested per-candidate distributions and reads no hidden data.

- [x] **Step 1: Add an exhaustive joint-distribution test oracle**

In `test/ai-planner.test.js`, add `bruteForceHitCountDistribution(board, center)`. For boards with at most 20 hidden cells, enumerate every assignment, keep assignments with exactly `remainMines` mines that satisfy all public clues, count mines in the in-bounds 5×5 footprint, and return the normalized hit-count array. Keep the existing marginal oracle intact.

- [x] **Step 2: Add failing exact-distribution tests**

Test a correlated clue with `view(3, 1, [-2, 1, -2], 1, 1)`: a blast at `(0,0)` covers both hidden cells, so the exact distribution must be `[0, 1, 0]`. Test a free-only board `view(4, 3, Array(12).fill(-2), 4)` by comparing every bomb center with the oracle. Also compare all candidate distributions for the existing 15×1 separated-frontier fixture with the oracle. For every exact center assert total probability is 1 within `1e-12` and `expectedMines` equals `Σ(k * p[k])` within `1e-10`. For `analyze(board, { maxSearchNodes: 0 })`, assert every center distribution is `null`.

- [x] **Step 3: Run planner tests and verify RED**

Run: `node --test test/ai-planner.test.js`
Expected: new distribution assertions fail because candidates currently expose only `estimatedHitCountProbabilities`.

- [x] **Step 4: Implement the no-clue hypergeometric case**

When there are no clue constraints, let `N` be hidden cells, `R` be `remainMines`, and `f` be the hidden cells in a candidate blast. For feasible `k`, compute `C(f,k) * C(N-f,R-k) / C(N,R)` using `BigInt` binomial counts and the corrected `ratio()` helper. Pass the exact candidate distributions into `createAnalysis`. Run the free-only/clipped-blast oracle and confirm GREEN.

- [x] **Step 5: Extend exact component enumeration with hit masks**

In `enumerateCluster`, store a compact local mine mask and `mineCount` for each satisfying assignment, alongside current `hist` and `strata`. For each candidate center build each component's `W_j[m][b]` by counting total mines `m` and blast mines `b`; combine component tables with a two-dimensional `BigInt` convolution. For free cells, use `C(f,h) * C(F-f,q-h)` where `q = remainMines - frontierMines`; aggregate into total blast-hit counts and divide by the already-computed exact layout denominator. On search-budget exhaustion, discard partial joint results and mark analysis approximate with `null` candidate distributions. Run the correlation and separated-component oracle tests and confirm GREEN.

- [x] **Step 6: Remove obsolete analysis fields**

Delete `hasSinglePossibleMineRegion`, `singlePossibleMineRegion`, and the independent-marginal `estimatedHitCountProbabilities` construction. Publish frozen exact arrays or `null`, preserve candidate and distribution immutability, and retain `expectedMines` from public marginals (assert its first-moment agreement on exact cases). Update previous shape assertions. Run: `node --test test/ai-planner.test.js`.

- [x] **Step 7: Benchmark the standard public state**

Run all planner tests and a timed exact analysis of a 15×15/53-mine view with 8 frontier cells and 215 free cells. Record quality and elapsed time (the planner does not expose search-node count). Observed: exact quality, 223 hidden cells, 8 frontier, 215 free, 223 bomb centers, max footprint 25, direct-win probability 0, 19.353 ms cold. For same seed 100001/84 moves, instrumented runtime fell from 962.16 ms/948.56 ms in planner to 59.20 ms/46.00 ms with override off; at threshold 0.75 it took 116.88 ms/106.71 ms in planner and made five joint requests. After review, ordinary exact analysis was benchmarked on this same fixture for 200 warmed calls before/after removing joint-only assignment retention: mean 0.2238 ms before and 0.2160 ms after; this small timing difference is not treated as a performance claim. Instrumented tests verify that ordinary analysis creates no joint mask conversions or retained assignments, while opt-in analysis still does. All exact oracle tests pass, approximate/unrequested distributions are `null`, and neither removed field is published.

- [x] **Step 8: Include the planner unit in the final integration commit**

No intermediate planner-only commit was made, to avoid committing an incomplete strategy before the plugin, runtime, tournaments, and documentation were ready. `js/ai-planner.js` and `test/ai-planner.test.js` are included in final integration commit `2b16bff3c539f919e1e8c38eb1a03aa5d40d7077`.

---

### Task 2: Apply the direct-win override in Invincible

**Files:**
- Modify: `plugin/ai-constraint-probability.js`
- Modify: `plugin/ai-config.js`
- Test: `test/strong-plugin.test.js`

**Interfaces:**
- Read `window.MineAIConfig.bombWinProbabilityThreshold`; accept `null`/absent or finite `(0, 1]`.
- For exact candidate distribution `p[k]`, compute `Pwin = Σ p[k]` for `k >= floor(view.mineCount / 2) + 1 - view.score`. Approximate analysis or a `null` distribution has no direct-win override probability.
- `chooseBomb(view)` returns `null` or `{ type: 'bomb', x, y }`; it consumes no region/connectivity flag.

- [x] **Step 1: Add the failing opening regression and policy tests**

In `test/strong-plugin.test.js`, expose mutable `window.MineAIConfig` in the sandbox. Add the opening public fixture: 15×15, all cells hidden except a revealed mine at `(14,14)` and clue `2` at `(7,7)`, `mineCount: 53`, `remainMines: 52`, score `0–1`, one legal bomb. Assert `neededHits === 27`, every center has at most 25 hidden cells in its footprint, every `Pwin` is zero, and the decision is not a bomb. Add a 7×7 exact fixture with three hidden mines all covered by one blast; at threshold `1.0`, assert a concrete bomb is returned despite the score-gap conservation fallback. Add a below-cutoff case that conserves when expected yield reaches the deficit, an expected-yield desperate-use case, an approximate-analysis case with no override, and leading/disabled/no-inventory legality cases.

- [x] **Step 2: Run plugin tests and verify RED**

Run: `node --test test/strong-plugin.test.js`
Expected: the opening fixture fails because the current region branch selects an expected-yield center when all direct-win probabilities are zero; threshold tests fail because the current plugin consumes the old fields.

- [x] **Step 3: Implement probability ranking and comeback fallback**

Remove `selectByEstimatedWinProbability` and all region branching. Among exact candidates with `Pwin >= configured threshold`, maximize `Pwin` and break ties by `expectedMines`; return the coordinate before score-gap conservation. If no candidate qualifies, spend only if the maximum `expectedMines` is strictly less than `oppScore - score`; otherwise conserve and continue the existing open policy. Keep `!view.canBomb`, zero inventory, and no hidden center guards. Run the plugin tests and confirm GREEN.

- [x] **Step 4: Verify plugin and engine bomb legality**

Run: `node --test test/strong-plugin.test.js test/bomb-area.test.js`. Expected: high-probability direct wins override the score-gap heuristic; the one-point opening with `Pwin = 0` does not bomb via the direct-win path; desperate expected-yield behavior and engine legality remain intact.

---

### Task 3: Make threshold sweeps and paired comparisons reproducible

**Files:**
- Modify: `scripts/ai-tournament-runtime.js`
- Modify: `scripts/ai-tournament-stats.js`
- Modify: `scripts/ai-tournament.js`
- Create: `scripts/compare-ai-tournament-treatments.js`
- Test: `test/ai-tournament.test.js`

**Interfaces:**
- `createRuntime(seed, { bombWinProbabilityThreshold } = {})` loads `plugin/ai-config.js`; an explicit override replaces the production config.
- `runMatch` and `runTournament` forward the optional threshold without changing seeds, seats, or map generation.
- CLI accepts `--bomb-win-probability-threshold off|P`; `P` must be finite in `(0,1]`; absent means production config. Report the effective threshold.
- Each match result records `directBombs`, `directBombWins`, mean predicted probability, and per-bomb public forecast/outcome records. Tournament summaries and treatment comparisons report forecast calibration count, mean prediction, realized direct-win rate, Brier score, and fixed probability bins. Public traces include `{ model: 'uniform-valid-layouts', neededHits, winProbability, threshold }`; actual `directWin` is recorded only after resolution from the score result.
- Export `compareTournamentTreatments(baselineClusters, treatmentClusters, { bootstrapSeed, bootstrapReplicates })`; require equal seed sets and per-seed map hashes; compare per-seed, two-seat average win points and score margin with deterministic cluster-bootstrap 95% intervals. The CLI accepts exactly two positional report-file or chunk-directory paths; concrete commands appear in Task 4.

- [x] **Step 1: Add failing threshold, trace, and pairing tests**

In `test/ai-tournament.test.js`, test parsing of `off` and `0.75`, and rejection of `0`, `-0.1`, and `1.1`; test that threshold metadata appears in JSON; instantiate same-seed runtimes with different thresholds and assert identical map hashes; assert an Invincible bomb trace has a public forecast and post-resolution `directWin`, with no `hiddenMap` in the public trace. Add paired-comparison fixtures with one matching seed/map and one mismatched map; assert the matching case returns deterministic deltas and the mismatched case throws. Preserve the existing separate post-game hidden-map-file test.

- [x] **Step 2: Run tournament tests and verify RED**

Run: `node --test test/ai-tournament.test.js`
Expected: threshold parsing/injection, forecast metrics, and paired-comparison tests fail because the runner currently has no cutoff or comparison interface.

- [x] **Step 3: Implement runtime/CLI threshold injection and diagnostics**

Load `plugin/ai-config.js` in the tournament VM before loading the Invincible plugin; apply explicit overrides, map `off` to `null`, and validate numeric thresholds in `(0,1]`. Forward thresholds through `runTournament` and `runMatch`; record them in the report. For each resolved Invincible bomb, sum the selected candidate distribution from `neededHits` to compute public forecast; after `Game.bomb()` resolves, compute `directWin` from `scoresAfter[actor] >= floor(mineCount / 2) + 1`. Aggregate direct bomb counts, realized direct wins, and forecast sums in match results.

- [x] **Step 4: Implement and test paired treatment comparison**

Use seed-indexed clusters; reject duplicate/missing seeds, mismatched map hashes, or incomplete blue/red seat pairs. For each paired seed compute the treatment-minus-control mean of the two games' win points and score margins. Use the existing seeded word generator for deterministic cluster bootstrap percentiles. Add the CLI that loads either report files or all JSON report chunks from each input directory, compares both opponents, and prints machine-readable JSON. Run: `node --test test/ai-tournament.test.js`.

- [x] **Step 5: Verify trace privacy and stable pairing**

Run the existing one-seed tournament test with `--trace-dir` and `--include-hidden-map`. Confirm map generation is unchanged across cutoffs, both seats use the same seed map, public traces have no hidden map, hidden maps remain in the separate post-game file, and forecast data contains only public information.

---

### Task 4: Screen cutoffs, validate once on held-out maps, and report

**Files:**
- Modify after evidence: `plugin/ai-config.js`
- Modify after evidence: `docs/superpowers/reports/2026-10-06-minestorm-ai-baseline.md`
- Create: `docs/superpowers/reports/2026-10-06-joint-bomb-win-probability.md`
- Artifacts: `C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/`

**Interfaces:**
- Development cutoffs: `off`, `0.5`, `0.75`, `0.9`, `1.0`.
- Development seeds: `100000–100099`; validation seeds: `1000000000–1000000999`.
- Both opponents and both Invincible seats are required; preserve seed/map pairing and the strict invalid-decision guard.

- [x] **Step 1: Run the five development treatments**

Create `C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/`. Run each exact command below; they use the same 100 development seeds and both opponents:

```bash
node scripts/ai-tournament.js --opponent both --seed-start 100000 --seed-count 100 --bomb-win-probability-threshold off --output C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/dev-off.json
node scripts/ai-tournament.js --opponent both --seed-start 100000 --seed-count 100 --bomb-win-probability-threshold 0.5 --output C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/dev-050.json
node scripts/ai-tournament.js --opponent both --seed-start 100000 --seed-count 100 --bomb-win-probability-threshold 0.75 --output C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/dev-075.json
node scripts/ai-tournament.js --opponent both --seed-start 100000 --seed-count 100 --bomb-win-probability-threshold 0.9 --output C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/dev-090.json
node scripts/ai-tournament.js --opponent both --seed-start 100000 --seed-count 100 --bomb-win-probability-threshold 1.0 --output C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/dev-100.json
```

Compare each treatment with the disabled control and save outputs:

```bash
node scripts/compare-ai-tournament-treatments.js C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/dev-off.json C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/dev-050.json > C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/compare-050.json
node scripts/compare-ai-tournament-treatments.js C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/dev-off.json C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/dev-075.json > C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/compare-075.json
node scripts/compare-ai-tournament-treatments.js C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/dev-off.json C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/dev-090.json > C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/compare-090.json
node scripts/compare-ai-tournament-treatments.js C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/dev-off.json C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/dev-100.json > C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/compare-100.json
```

Confirm each report has 100 paired seed clusters per opponent, both Invincible seats, equal map hashes, and zero errors. If interrupted, preserve outputs, inspect the exact command, and rerun only missing seeds.

- [x] **Step 2: Select and freeze one cutoff before validation**

Completed: `selected-threshold.txt` was written as exactly `0.5` before held-out runs; detailed paired development intervals and the selection rule are in `dev-selection.json`.

Choose the cutoff with the highest equal-weight mean paired win points across Simple and Medium; break exact ties by mean paired score margin, then choose the higher cutoff. Before starting validation, write only the selected numeric value to `selected-threshold.txt` (the validation loop parses this file) and record the paired development intervals in `dev-selection.json`. Do not inspect validation outcomes before the selection file is written.

- [x] **Step 3: Run 1,000 held-out paired clusters per treatment**

Create directories `C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/validation-off/` and `C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/validation-selected/`. For each directory, execute this bounded Bash loop; for the selected treatment, read the numeric value from `selected-threshold.txt` instead of `off`:

```bash
for offset in 0 100 200 300 400 500 600 700 800 900; do
  seed=$((1000000000 + offset))
  node scripts/ai-tournament.js --opponent both --seed-start "$seed" --seed-count 100 --bomb-win-probability-threshold off --output "C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/validation-off/$seed.json" || exit 1
done
```

For the selected treatment, read the frozen value and run the same loop into `validation-selected`:

```bash
selected_threshold=$(node -e 'process.stdout.write(require("node:fs").readFileSync("C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/selected-threshold.txt", "utf8").trim())')
for offset in 0 100 200 300 400 500 600 700 800 900; do
  seed=$((1000000000 + offset))
  node scripts/ai-tournament.js --opponent both --seed-start "$seed" --seed-count 100 --bomb-win-probability-threshold "$selected_threshold" --output "C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/validation-selected/$seed.json" || exit 1
done
```

Compare the two directories with `node scripts/compare-ai-tournament-treatments.js C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/validation-off C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/validation-selected`. Verify 1,000 unique seed clusters per opponent, identical maps, both seats, and zero errors.

- [x] **Step 4: Adopt only a validated cutoff and document evidence**

Applied cutoff `0.5` in `plugin/ai-config.js`: combined held-out paired win-point delta +0.0235 (95% CI +0.0185 to +0.0285), with both opponents' point estimates and intervals positive; no traced `Pwin = 1` bomb failed. Updated `docs/superpowers/reports/2026-10-06-minestorm-ai-baseline.md` and created `docs/superpowers/reports/2026-10-06-joint-bomb-win-probability.md`; both distinguish the `P_uniform` model from the actual map-generator prior and state evidence scope.

- [x] **Step 5: Run final checks and commit**

Completed: `node --test test/*.test.js` passed 109/109; `git diff --check` passed (Git emitted only LF→CRLF working-copy warnings); superseded API symbol search returned no matches; independent follow-up review verdict OK. Commit `2b16bff3c539f919e1e8c38eb1a03aa5d40d7077` contains the full strategy, tests, tournament artifacts/reporting, and documentation.
